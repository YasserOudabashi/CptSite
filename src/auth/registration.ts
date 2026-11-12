import { randomInt } from 'node:crypto';
import { Pool } from 'pg';
import { checkGeneralCode, isAllowedStudentId } from '../admin/studentList';
import { MailSendError, sendPersonalCode } from '../mail';
import { hashSecret, verifySecret } from './password';

export const MAX_ATTEMPTS_PER_HOUR = 5;
export const PERSONAL_CODE_HOURS = 24;

export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid' | 'exists' | 'mail_failed' | 'missing_fields' };

export interface StartInput {
  loginId: string;
  generalCode: string;
  firstName: string;
  lastName: string;
  className: string;
  ip: string;
}

// Conta il tentativo e dice se il limite (5 all'ora per ID e per IP) è già superato.
async function tooManyAttempts(pool: Pool, loginId: string, ip: string): Promise<boolean> {
  const keys: [string, string][] = [['id', loginId.toLowerCase()], ['ip', ip]];
  let blocked = false;
  for (const [kind, key] of keys) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM registration_attempts
       WHERE kind = $1 AND key = $2 AND created_at > now() - interval '1 hour'`,
      [kind, key],
    );
    if (rows[0].n >= MAX_ATTEMPTS_PER_HOUR) blocked = true;
  }
  if (!blocked) {
    for (const [kind, key] of keys) {
      await pool.query('INSERT INTO registration_attempts (kind, key) VALUES ($1, $2)', [kind, key]);
    }
  }
  return blocked;
}

// Passo 1: valida ID e codice generale, salva il codice personale (hashato, 24 ore) e lo invia per mail.
// Se l'invio fallisce il codice viene cancellato: nessun codice resta valido senza essere stato inviato.
export async function startRegistration(pool: Pool, input: StartInput): Promise<StartResult> {
  const loginId = input.loginId.trim();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const className = input.className.trim();

  if (await tooManyAttempts(pool, loginId, input.ip)) return { ok: false, reason: 'rate_limited' };

  if (!loginId || !firstName || !lastName || !className) return { ok: false, reason: 'missing_fields' };
  // Stesso errore per ID non ammesso e codice generale sbagliato: non si dice quale dei due.
  const idOk = await isAllowedStudentId(pool, loginId);
  const codeOk = await checkGeneralCode(pool, input.generalCode);
  if (!idOk || !codeOk) return { ok: false, reason: 'invalid' };

  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE lower(login_id) = lower($1)', [loginId]);
  if (rowCount) return { ok: false, reason: 'exists' };

  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  await pool.query(
    `INSERT INTO registration_codes (login_id, first_name, last_name, class_name, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
     ON CONFLICT (lower(login_id)) DO UPDATE SET
       first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, class_name = EXCLUDED.class_name,
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [loginId, firstName, lastName, className, await hashSecret(code), PERSONAL_CODE_HOURS],
  );
  try {
    await sendPersonalCode(loginId, code);
  } catch (err) {
    if (!(err instanceof MailSendError)) throw err;
    await pool.query('DELETE FROM registration_codes WHERE lower(login_id) = lower($1)', [loginId]);
    return { ok: false, reason: 'mail_failed' };
  }
  return { ok: true };
}

export const MIN_PASSWORD_LENGTH = 10;

export type CompleteResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'bad_code' | 'password_short' | 'password_mismatch' };

// Passo 2: con il codice personale corretto e non scaduto si sceglie la password e si crea l'utente (ruolo Allievo).
// Anche qui 5 tentativi all'ora per ID, perché il codice ha solo 8 cifre.
export async function completeRegistration(
  pool: Pool,
  input: { loginId: string; code: string; password: string; password2: string },
): Promise<CompleteResult> {
  const loginId = input.loginId.trim();
  const key = `verify:${loginId.toLowerCase()}`;
  const { rows: att } = await pool.query(
    `SELECT count(*)::int AS n FROM registration_attempts
     WHERE kind = 'verify' AND key = $1 AND created_at > now() - interval '1 hour'`,
    [key],
  );
  if (att[0].n >= MAX_ATTEMPTS_PER_HOUR) return { ok: false, reason: 'rate_limited' };

  const { rows } = await pool.query(
    `SELECT first_name, last_name, class_name, code_hash FROM registration_codes
     WHERE lower(login_id) = lower($1) AND expires_at > now()`,
    [loginId],
  );
  if (!rows.length || !(await verifySecret(input.code.trim(), rows[0].code_hash))) {
    await pool.query(`INSERT INTO registration_attempts (kind, key) VALUES ('verify', $1)`, [key]);
    return { ok: false, reason: 'bad_code' };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'password_short' };
  if (input.password !== input.password2) return { ok: false, reason: 'password_mismatch' };

  const passwordHash = await hashSecret(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Il DELETE garantisce che il codice sia monouso anche con due richieste simultanee.
    const del = await client.query('DELETE FROM registration_codes WHERE lower(login_id) = lower($1)', [loginId]);
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'bad_code' };
    }
    const { rows: u } = await client.query(
      `INSERT INTO users (login_id, first_name, last_name, class_name, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [loginId, rows[0].first_name, rows[0].last_name, rows[0].class_name, passwordHash],
    );
    await client.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'allievo')`, [u[0].id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

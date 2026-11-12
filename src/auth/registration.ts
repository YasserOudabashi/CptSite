import { randomInt } from 'node:crypto';
import { Pool } from 'pg';
import { checkGeneralCode, isAllowedStudentId } from '../admin/studentList';
import { MailSendError, sendPersonalCode } from '../mail';
import { hashSecret } from './password';

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

import { randomInt } from 'node:crypto';
import { Pool } from 'pg';
import { MailSendError, sendPasswordReset } from '../mail';
import { hashSecret, verifySecret } from './password';
import { MIN_PASSWORD_LENGTH } from './registration';
import { MAX_ATTEMPTS_PER_HOUR, hit, ipLimitPerHour } from './rateLimit';

export const RESET_CODE_MINUTES = 30;

export type RequestResetResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'mail_failed' };

// Chiede il codice di recupero. Il risultato è lo stesso se l'ID esiste o no (nessuna informazione sull'esistenza).
// Limite 5 richieste all'ora per ID e 300 per IP. Se l'invio fallisce il codice viene cancellato.
export async function requestPasswordReset(pool: Pool, loginIdRaw: string, ip: string): Promise<RequestResetResult> {
  const loginId = loginIdRaw.trim().toLowerCase();
  if ((await hit(pool, [['reset-id', loginId, MAX_ATTEMPTS_PER_HOUR], ['reset-ip', ip, ipLimitPerHour()]])).blocked) return { ok: false, reason: 'rate_limited' };
  const { rows } = await pool.query('SELECT id, login_id FROM users WHERE lower(login_id) = $1', [loginId]);
  if (!rows.length) return { ok: true };

  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  await pool.query(
    `INSERT INTO password_resets (user_id, code_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (user_id) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [rows[0].id, await hashSecret(code), RESET_CODE_MINUTES],
  );
  try {
    await sendPasswordReset(rows[0].login_id, code);
  } catch (err) {
    if (!(err instanceof MailSendError)) throw err;
    await pool.query('DELETE FROM password_resets WHERE user_id = $1', [rows[0].id]);
    return { ok: false, reason: 'mail_failed' };
  }
  return { ok: true };
}

export type ResetResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'bad_code' | 'password_short' | 'password_mismatch' };

// Con il codice monouso sceglie la nuova password e chiude tutte le sessioni dell'utente.
export async function completePasswordReset(
  pool: Pool,
  input: { loginId: string; code: string; password: string; password2: string },
): Promise<ResetResult> {
  const loginId = input.loginId.trim().toLowerCase();
  const attempt = await hit(pool, [['reset-verify', `reset-verify:${loginId}`, MAX_ATTEMPTS_PER_HOUR]]);
  if (attempt.blocked) return { ok: false, reason: 'rate_limited' };

  const { rows } = await pool.query(
    `SELECT u.id, r.code_hash FROM users u JOIN password_resets r ON r.user_id = u.id
     WHERE lower(u.login_id) = $1 AND r.expires_at > now()`,
    [loginId],
  );
  if (!rows.length || !(await verifySecret(input.code.trim(), rows[0].code_hash))) {
    return { ok: false, reason: 'bad_code' };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'password_short' };
  if (input.password !== input.password2) return { ok: false, reason: 'password_mismatch' };

  const passwordHash = await hashSecret(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Il DELETE rende il codice monouso anche con richieste simultanee.
    const del = await client.query('DELETE FROM password_resets WHERE user_id = $1', [rows[0].id]);
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'bad_code' };
    }
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, rows[0].id]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
    await client.query('DELETE FROM login_failures WHERE login_id = $1', [loginId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await attempt.undo();
  return { ok: true };
}

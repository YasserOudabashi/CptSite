import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { hashSecret } from '../auth/password';

export const INVITE_DAYS = 14;
export const INVITE_ROLES = ['docente', 'relatore'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];
const MIN_PASSWORD_LENGTH = 10;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Invite {
  id: number;
  role_code: InviteRole;
  first_name: string;
  last_name: string;
  email: string;
}

// Crea l'invito e restituisce il token (da mettere nel link /invito/<token>); il sito non invia la mail.
export async function createInvite(
  pool: Pool,
  input: { role: string; firstName: string; lastName: string; email: string },
): Promise<string> {
  const role = input.role as InviteRole;
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim();
  if (!INVITE_ROLES.includes(role)) throw new Error('Tipo di invito non valido.');
  if (!firstName || !lastName) throw new Error('Nome e cognome sono obbligatori.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indirizzo e-mail non valido.');
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE lower(login_id) = lower($1)', [email]);
  if (rowCount) throw new Error('Esiste già un utente con questo indirizzo.');
  const token = randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO invites (token_hash, role_code, first_name, last_name, email, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [sha(token), role, firstName, lastName, email, INVITE_DAYS],
  );
  return token;
}

// Invito valido (non scaduto, non usato) oppure null.
export async function findValidInvite(pool: Pool, token: string): Promise<Invite | null> {
  const { rows } = await pool.query(
    `SELECT id, role_code, first_name, last_name, email FROM invites
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha(token)],
  );
  return rows[0] ?? null;
}

export type AcceptResult = { ok: true } | { ok: false; reason: 'invalid' | 'password_short' | 'password_mismatch' | 'exists' };

// Registrazione con invito: crea l'utente col ruolo dell'invito (senza classe) e brucia il link.
export async function acceptInvite(
  pool: Pool,
  token: string,
  password: string,
  password2: string,
): Promise<AcceptResult> {
  if (!(await findValidInvite(pool, token))) return { ok: false, reason: 'invalid' };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'password_short' };
  if (password !== password2) return { ok: false, reason: 'password_mismatch' };
  const passwordHash = await hashSecret(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // L'UPDATE condizionato rende il link monouso anche con richieste simultanee.
    const { rows } = await client.query(
      `UPDATE invites SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING role_code, first_name, last_name, email`,
      [sha(token)],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid' };
    }
    const inv = rows[0];
    const dup = await client.query('SELECT 1 FROM users WHERE lower(login_id) = lower($1)', [inv.email]);
    if (dup.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'exists' };
    }
    const { rows: u } = await client.query(
      `INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [inv.email, inv.first_name, inv.last_name, passwordHash],
    );
    await client.query('INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)', [u[0].id, inv.role_code]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

export async function listInvites(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT id, role_code, first_name, last_name, email, expires_at, used_at FROM invites ORDER BY created_at DESC LIMIT 100`,
  );
  return rows as (Invite & { expires_at: Date; used_at: Date | null })[];
}

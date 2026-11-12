import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';
import { verifySecret } from './password';
import type { RoleCode } from '../users/roles';

export const COOKIE = 'sid';
const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' | 'locked' };

export async function login(pool: Pool, loginId: string, password: string): Promise<LoginResult> {
  const id = loginId.trim().toLowerCase();
  const { rows: f } = await pool.query(
    `SELECT count(*)::int AS n FROM login_failures
     WHERE login_id = $1 AND created_at > now() - make_interval(mins => $2)`,
    [id, LOCK_MINUTES],
  );
  if (f[0].n >= MAX_FAILURES) return { ok: false, reason: 'locked' };

  const { rows } = await pool.query<{ id: number; password_hash: string | null }>(
    'SELECT id, password_hash FROM users WHERE lower(login_id) = $1',
    [id],
  );
  const user = rows[0];
  const ok = !!user?.password_hash && (await verifySecret(password, user.password_hash));
  if (!ok) {
    await pool.query('INSERT INTO login_failures (login_id) VALUES ($1)', [id]);
    return { ok: false, reason: 'invalid' };
  }
  await pool.query('DELETE FROM login_failures WHERE login_id = $1', [id]);
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [sha(token), user.id, SESSION_HOURS],
  );
  return { ok: true, token };
}

export async function logout(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_HOURS * 3600): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// Imposta `req.user` dal cookie di sessione (se valido).
export function sessionMiddleware(pool: Pool) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = readCookie(req, COOKIE);
      if (token) {
        const { rows } = await pool.query<{ user_id: number; roles: RoleCode[] }>(
          `SELECT s.user_id,
                  COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
           FROM sessions s LEFT JOIN user_roles ur ON ur.user_id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()
           GROUP BY s.user_id`,
          [sha(token)],
        );
        if (rows[0]) req.user = { id: rows[0].user_id, roles: rows[0].roles };
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

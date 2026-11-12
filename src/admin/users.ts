import { Pool } from 'pg';
import { assignRole, removeRole, type RoleCode } from '../users/roles';

export const ROLE_CODES: RoleCode[] = ['allievo', 'docente', 'relatore', 'resp_ga', 'resp_sito'];

export interface UserRow {
  id: number;
  login_id: string;
  first_name: string;
  last_name: string;
  roles: RoleCode[];
}

export async function searchUsers(pool: Pool, q = ''): Promise<UserRow[]> {
  const like = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.login_id, u.first_name, u.last_name,
            COALESCE(array_agg(ur.role_code ORDER BY ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.login_id ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
         OR (u.first_name || ' ' || u.last_name) ILIKE $1
      GROUP BY u.id ORDER BY u.last_name, u.first_name LIMIT 200`,
    [like],
  );
  return rows;
}

export async function addUserRole(pool: Pool, userId: number, role: string): Promise<void> {
  if (!ROLE_CODES.includes(role as RoleCode)) throw new Error('Ruolo non valido');
  await assignRole(pool, userId, role as RoleCode);
}

/** Toglie un ruolo; l'ultimo Responsabile sito non si può togliere. */
export async function dropUserRole(pool: Pool, userId: number, role: string): Promise<void> {
  if (!ROLE_CODES.includes(role as RoleCode)) throw new Error('Ruolo non valido');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (role === 'resp_sito') {
      // Blocca le righe resp_sito: due rimozioni simultanee non possono svuotare il ruolo.
      const { rows } = await client.query<{ user_id: number }>(
        `SELECT user_id FROM user_roles WHERE role_code = 'resp_sito' FOR UPDATE`,
      );
      if (rows.length <= 1 && rows.some((r) => r.user_id === userId)) {
        throw new Error('Non si può togliere l\'ultimo Responsabile sito');
      }
    }
    await removeRole(client as unknown as Pool, userId, role as RoleCode);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

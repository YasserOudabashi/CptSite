import { Pool } from 'pg';

export type RoleCode = 'allievo' | 'docente' | 'relatore' | 'resp_ga' | 'resp_tornei' | 'resp_sito';

export async function assignRole(pool: Pool, userId: number, role: RoleCode): Promise<void> {
  await pool.query(
    'INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, role],
  );
}

export async function removeRole(pool: Pool, userId: number, role: RoleCode): Promise<void> {
  await pool.query('DELETE FROM user_roles WHERE user_id = $1 AND role_code = $2', [userId, role]);
}

export async function getUserRoles(pool: Pool, userId: number): Promise<RoleCode[]> {
  const { rows } = await pool.query<{ role_code: RoleCode }>(
    'SELECT role_code FROM user_roles WHERE user_id = $1 ORDER BY role_code',
    [userId],
  );
  return rows.map((r) => r.role_code);
}

export async function getCurrentSchoolYear(pool: Pool): Promise<{ id: number; name: string }> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM school_years WHERE is_current',
  );
  if (rows.length !== 1) throw new Error('Nessun anno scolastico corrente impostato');
  return rows[0];
}

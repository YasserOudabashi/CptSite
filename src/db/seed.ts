import { Pool } from 'pg';

// Crea il Responsabile sito iniziale se non esiste ancora nessun utente con quel ruolo.
// La password resta NULL: si imposta con il recupero password (US-008).
export async function seed(pool: Pool): Promise<void> {
  const loginId = process.env.ADMIN_LOGIN_ID ?? 'admin@samtrevano.ch';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT 1 FROM user_roles WHERE role_code = 'resp_sito' LIMIT 1`,
    );
    if (rows.length === 0) {
      const { rows: inserted } = await client.query(
        `INSERT INTO users (login_id, first_name, last_name)
         VALUES ($1, 'Responsabile', 'sito')
         ON CONFLICT (lower(login_id)) DO UPDATE SET login_id = EXCLUDED.login_id
         RETURNING id`,
        [loginId],
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'resp_sito')
         ON CONFLICT DO NOTHING`,
        [inserted[0].id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

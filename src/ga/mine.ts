import { Pool } from 'pg';

export type Mine = {
  id: number;
  title: string;
  description: string;
  status: string;
  reject_reason: string | null;
  max_participants: number;
  sessions: { id: number; block: string; attendees: { name: string; class_name: string | null }[] }[];
};

// Attività proposte dall'utente nell'anno corrente, con sessioni e iscritti.
export async function listMine(pool: Pool, userId: number): Promise<Mine[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, a.status, a.reject_reason, a.max_participants,
       COALESCE((SELECT json_agg(json_build_object('id', s.id, 'block', b.name, 'attendees', COALESCE((
           SELECT json_agg(json_build_object('name', u.last_name || ' ' || u.first_name, 'class_name', u.class_name)
                           ORDER BY u.last_name, u.first_name)
           FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.session_id = s.id), '[]'::json)) ORDER BY s.repeat_no)
         FROM activity_sessions s JOIN time_blocks b ON b.id = s.start_block_id WHERE s.activity_id = a.id), '[]'::json) AS sessions
     FROM activities a
     WHERE a.organizer_id = $1 AND a.school_year_id = (SELECT id FROM school_years WHERE is_current)
     ORDER BY a.id`,
    [userId],
  );
  return rows;
}

// Modifica descrizione e massimo, solo delle proprie attività; il massimo non scende sotto gli iscritti di nessuna sessione.
// Stesso lock dell'iscrizione (FOR UPDATE sull'attività): nessuna iscrizione passa mentre si cambia il massimo.
export async function updateMine(pool: Pool, userId: number, id: number, description: string, max: number): Promise<void> {
  description = description.trim();
  if (!description) throw new Error('La descrizione è obbligatoria.');
  if (!Number.isInteger(max) || max < 1) throw new Error('Il massimo deve essere almeno 1.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const own = await client.query('SELECT min_participants FROM activities WHERE id = $1 AND organizer_id = $2 FOR UPDATE', [id, userId]);
    if (!own.rowCount) throw new Error('Attività non trovata.');
    if (own.rows[0].min_participants > max) throw new Error('Il massimo non può essere sotto il minimo.');
    const { rows } = await client.query(
      `SELECT 1 FROM enrollments e JOIN activity_sessions s ON s.id = e.session_id WHERE s.activity_id = $1 GROUP BY s.id HAVING count(*) > $2`,
      [id, max],
    );
    if (rows.length) throw new Error('Il massimo non può scendere sotto il numero di iscritti attuali.');
    await client.query('UPDATE activities SET description = $2, max_participants = $3 WHERE id = $1', [id, description, max]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

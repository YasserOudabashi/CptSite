import { Pool } from 'pg';

const CUR = '(SELECT id FROM school_years WHERE is_current)';
// Anni precedenti a quello corrente (non gli eventuali anni futuri già creati).
const PREV = '(SELECT id FROM school_years WHERE name < (SELECT name FROM school_years WHERE is_current))';

// Attività degli anni passati dell'organizzatore (per "Riproponi").
export async function previousMine(pool: Pool, userId: number): Promise<{ id: number; title: string; year: string }[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, y.name AS year FROM activities a JOIN school_years y ON y.id = a.school_year_id
     WHERE a.organizer_id = $1 AND y.id IN ${PREV} ORDER BY y.name DESC, a.title`,
    [userId],
  );
  return rows;
}

// Valori del modulo "Proponi" copiati da un'attività passata propria; l'originale non si tocca, il giorno va riscelto.
export async function prefillFrom(pool: Pool, userId: number, id: number): Promise<Record<string, string> | null> {
  const { rows } = await pool.query(
    `SELECT a.* FROM activities a JOIN school_years y ON y.id = a.school_year_id WHERE a.id = $1 AND a.organizer_id = $2 AND y.id IN ${PREV}`,
    [id, userId],
  );
  const a = rows[0];
  if (!a) return null;
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    title: a.title, description: a.description, phone: a.contact, room: s(a.room_id), duration: s(a.duration_blocks),
    repeat: a.repetitions === 2 ? '1' : '', first: s(a.first_block_id), second: s(a.second_block_id),
    materials: a.materials, min: s(a.min_participants), max: s(a.max_participants),
  };
}

// Relatori e docenti degli anni precedenti non ancora contatti dell'anno corrente (un'unica riga per persona, con i ruoli).
const PEOPLE_WHERE = `r.role_code IN ('relatore','docente')
     AND (EXISTS (SELECT 1 FROM activities a WHERE a.organizer_id = u.id AND a.school_year_id IN ${PREV})
          OR EXISTS (SELECT 1 FROM year_contacts c WHERE c.user_id = u.id AND c.school_year_id IN ${PREV}))
     AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.organizer_id = u.id AND a.school_year_id = ${CUR})
     AND NOT EXISTS (SELECT 1 FROM year_contacts c WHERE c.user_id = u.id AND c.school_year_id = ${CUR})`;

export async function previousPeople(pool: Pool): Promise<{ id: number; name: string; email: string; role: string }[]> {
  const { rows } = await pool.query(
    `SELECT u.id, u.last_name || ' ' || u.first_name AS name, u.login_id AS email, string_agg(DISTINCT r.role_code, ', ' ORDER BY r.role_code) AS role
     FROM users u JOIN user_roles r ON r.user_id = u.id WHERE ${PEOPLE_WHERE} GROUP BY u.id ORDER BY name`,
  );
  return rows;
}

// Solo persone presenti negli anni precedenti (stessa condizione di previousPeople): gli altri id si ignorano.
export async function addContacts(pool: Pool, ids: number[]): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO year_contacts (school_year_id, user_id)
     SELECT ${CUR}, u.id FROM users u JOIN user_roles r ON r.user_id = u.id
     WHERE u.id = ANY($1::int[]) AND ${PEOPLE_WHERE} GROUP BY u.id ON CONFLICT DO NOTHING`,
    [ids],
  );
  return rowCount ?? 0;
}

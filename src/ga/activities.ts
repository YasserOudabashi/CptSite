import { Pool } from 'pg';

export type SessionRow = {
  session_id: number;
  activity_id: number;
  title: string;
  description: string;
  organizer: string;
  organizer_kind: 'allievo' | 'docente' | 'relatore';
  room: string | null;
  block: string;
  start: string;
  end: string;
  block_count: number;
  enrolled: number;
  max: number;
};
export type Filters = { block?: number; room?: number; kind?: string; q?: string };

// Tipo di organizzatore: il più "alto" dei suoi ruoli (relatore > docente > allievo).
const KIND = `(CASE WHEN EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_code = 'relatore') THEN 'relatore'
  WHEN EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_code = 'docente') THEN 'docente' ELSE 'allievo' END)`;

// Una riga per sessione (un'attività ripetuta compare due volte) delle attività APPROVATE dell'anno corrente.
export async function listSessions(pool: Pool, f: Filters = {}): Promise<SessionRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  const p = (v: unknown) => `$${args.push(v)}`;
  if (f.block) where.push(`s.start_block_id = ${p(f.block)}`);
  if (f.room) where.push(`a.room_id = ${p(f.room)}`);
  if (f.kind) where.push(`${KIND} = ${p(f.kind)}`);
  if (f.q?.trim()) {
    const x = p(`%${f.q.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    where.push(`(a.title ILIKE ${x} OR a.description ILIKE ${x} OR (u.first_name || ' ' || u.last_name) ILIKE ${x} OR (u.last_name || ' ' || u.first_name) ILIKE ${x})`);
  }
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, a.id AS activity_id, a.title, a.description,
            u.first_name || ' ' || u.last_name AS organizer, ${KIND} AS organizer_kind,
            r.name AS room, b.name AS block, to_char(b.start_time, 'HH24:MI') AS start,
            to_char(COALESCE(be.end_time, b.end_time), 'HH24:MI') AS "end", s.block_count,
            (SELECT count(*)::int FROM enrollments e WHERE e.session_id = s.id) AS enrolled,
            a.max_participants AS max
     FROM activity_sessions s
     JOIN activities a ON a.id = s.activity_id
     JOIN school_years y ON y.id = a.school_year_id AND y.is_current
     JOIN users u ON u.id = a.organizer_id
     JOIN time_blocks b ON b.id = s.start_block_id
     LEFT JOIN rooms r ON r.id = a.room_id
     LEFT JOIN LATERAL (
       SELECT end_time FROM time_blocks WHERE kind = 'blocco' AND position >= b.position
       ORDER BY position OFFSET s.block_count - 1 LIMIT 1) be ON true
     WHERE a.status = 'approvata' ${where.map((w) => 'AND ' + w).join(' ')}
     ORDER BY b.position, a.title, s.repeat_no`,
    args,
  );
  return rows;
}

// Posti occupati di tutte le sessioni approvate dell'anno corrente (usato dall'SSE).
export async function seatsSnapshot(pool: Pool): Promise<Record<number, { n: number; max: number }>> {
  const { rows } = await pool.query(
    `SELECT s.id, a.max_participants AS max, (SELECT count(*)::int FROM enrollments e WHERE e.session_id = s.id) AS n
     FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
     JOIN school_years y ON y.id = a.school_year_id AND y.is_current WHERE a.status = 'approvata'`,
  );
  return Object.fromEntries(rows.map((r) => [r.id, { n: r.n, max: r.max }]));
}

export async function listRooms(pool: Pool): Promise<{ id: number; name: string }[]> {
  return (await pool.query('SELECT id, name FROM rooms ORDER BY lower(name)')).rows;
}

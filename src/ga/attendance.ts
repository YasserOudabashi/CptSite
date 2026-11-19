import { Pool } from 'pg';
import { can } from '../auth/permissions';
import type { RoleCode } from '../users/roles';
import { esc } from '../ui/layout';

type User = { id: number; roles: readonly RoleCode[] };
type Row = { organizer_id: number; school_year_id: number; is_current: boolean; status: string; title: string; description: string; organizer: string; room: string | null };

async function load(pool: Pool, id: number): Promise<Row | undefined> {
  return (await pool.query(
    `SELECT a.organizer_id, a.school_year_id, y.is_current, a.status, a.title, a.description, r.name AS room,
            u.first_name || ' ' || u.last_name AS organizer
     FROM activities a JOIN school_years y ON y.id = a.school_year_id JOIN users u ON u.id = a.organizer_id LEFT JOIN rooms r ON r.id = a.room_id
     WHERE a.id = $1`, [id])).rows[0];
}

// Chi organizza segna solo la sua attività; il Responsabile GA tutte. Si modifica fino alla chiusura dell'anno (anno non più corrente = sola lettura).
const canMark = (u: User, a: Row) => a.is_current && (can(u, 'ga.attendance.all') || (a.organizer_id === u.id && can(u, 'ga.attendance.own')));
const canSeeList = (u: User, a: Row) => can(u, 'ga.manage') || a.organizer_id === u.id;

export async function setAttendance(pool: Pool, user: User, activityId: number, sessionId: number, presentIds: number[]): Promise<void> {
  const a = await load(pool, activityId);
  if (!a || !canMark(user, a)) throw new Error('Non puoi segnare le presenze di questa attività.');
  const { rowCount } = await pool.query(
    `UPDATE enrollments SET present = (id = ANY($3::int[])) WHERE session_id = $2 AND activity_id = $1`,
    [activityId, sessionId, presentIds.filter(Number.isInteger)],
  );
  if (!rowCount) throw new Error('Nessun iscritto in questa sessione.');
}

// Pagina dell'attività; null = non esiste o non visibile a questo utente.
export async function activityPage(pool: Pool, user: User, id: number, flash = ''): Promise<string | null> {
  const a = await load(pool, id);
  if (!a) return null;
  const visible = can(user, 'ga.manage') || (a.is_current && (a.status === 'approvata' || a.organizer_id === user.id));
  if (!visible) return null;
  const sessions = (await pool.query(
    `SELECT s.id, b.name AS block, to_char(d.day, 'DD.MM.YYYY') AS day,
            COALESCE((SELECT json_agg(json_build_object('id', e.id, 'name', u.last_name || ' ' || u.first_name, 'class', u.class_name, 'present', e.present, 'assigned', e.assigned)
                      ORDER BY u.last_name, u.first_name)
                      FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.session_id = s.id), '[]'::json) AS people
     FROM activity_sessions s JOIN time_blocks b ON b.id = s.start_block_id JOIN ga_days d ON d.id = s.ga_day_id
     WHERE s.activity_id = $1 ORDER BY s.repeat_no`, [id])).rows as { id: number; block: string; day: string | null; people: { id: number; name: string; class: string | null; present: boolean | null; assigned: boolean }[] }[];
  const mark = canMark(user, a);
  const list = canSeeList(user, a);
  const sess = sessions.map((s) => {
    const rows = s.people.map((p) => {
      const label = `${esc(p.name)}${p.class ? ` (${esc(p.class)})` : ''}${p.assigned ? ' · assegnato' : ''}`;
      return mark
        ? `<li><label><input type="checkbox" name="present" value="${p.id}"${p.present ? ' checked' : ''}> ${label}</label></li>`
        : `<li>${label} — ${p.present === null ? 'non segnato' : p.present ? 'presente' : 'assente'}</li>`;
    });
    const body = list ? `<ul style="list-style:none;padding-left:0">${rows.join('') || '<li>Nessun iscritto.</li>'}</ul>` : `<p>${s.people.length} iscritti.</p>`;
    return `<h3>${esc(s.block)}${s.day ? ` · ${s.day}` : ''}</h3>${
      mark && s.people.length
        ? `<form method="post" action="/attivita/${id}/presenze"><input type="hidden" name="session" value="${s.id}">${body}<p><button>Salva le presenze</button> <small>(le caselle non spuntate = assenti)</small></p></form>`
        : body
    }`;
  });
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(a.title)}</title></head><body>
<h1>${esc(a.title)}</h1>
${flash}
<p>${esc(a.description)}</p>
<p><small>Organizzatore: ${esc(a.organizer)} · Aula: ${a.room ? esc(a.room) : 'da definire'}${a.is_current ? '' : ' · anno concluso (sola lettura)'}</small></p>
${sess.join('') || '<p>Nessuna sessione.</p>'}
</body></html>`;
}

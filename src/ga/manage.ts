import { Pool } from 'pg';
import { esc } from '../ui/layout';
import { listSchoolYears } from '../admin/settings';
import { STATES, getEnrollState } from './enroll';

export type ActivityRow = {
  id: number;
  title: string;
  status: string;
  organizer: string;
  room: string | null;
  min: number;
  max: number;
  sessions: { block: string; day: string | null; n: number }[];
};
export type Person = { id: number; name: string; email: string; phone: string; titles: string[] };

// Tutte le attività di un anno (qualsiasi stato) con blocco, aula e iscritti/max per sessione.
export async function listActivities(pool: Pool, yearId: number): Promise<ActivityRow[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.status, u.first_name || ' ' || u.last_name AS organizer, r.name AS room,
            a.min_participants AS min, a.max_participants AS max,
            COALESCE((SELECT json_agg(json_build_object('block', b.name, 'day', to_char(d.day, 'DD.MM'),
                        'n', (SELECT count(*)::int FROM enrollments e WHERE e.session_id = s.id)) ORDER BY s.repeat_no)
                      FROM activity_sessions s JOIN time_blocks b ON b.id = s.start_block_id JOIN ga_days d ON d.id = s.ga_day_id
                      WHERE s.activity_id = a.id), '[]'::json) AS sessions
     FROM activities a JOIN users u ON u.id = a.organizer_id LEFT JOIN rooms r ON r.id = a.room_id
     WHERE a.school_year_id = $1 ORDER BY a.title, a.id`,
    [yearId],
  );
  return rows;
}

// Anagrafica dell'anno: utenti con ruolo `role` che hanno un'attività nell'anno o sono stati riproposti come contatto.
export async function listPeople(pool: Pool, yearId: number, role: 'relatore' | 'docente'): Promise<Person[]> {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.login_id AS email,
            COALESCE((SELECT string_agg(DISTINCT a.contact, ', ') FROM activities a WHERE a.organizer_id = u.id AND a.school_year_id = $1 AND a.contact <> ''), '') AS phone,
            COALESCE((SELECT json_agg(a.title ORDER BY a.title) FROM activities a WHERE a.organizer_id = u.id AND a.school_year_id = $1), '[]'::json) AS titles
     FROM users u
     WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role_code = $2)
       AND (EXISTS (SELECT 1 FROM activities a WHERE a.organizer_id = u.id AND a.school_year_id = $1)
            OR EXISTS (SELECT 1 FROM year_contacts c WHERE c.user_id = u.id AND c.school_year_id = $1))
     ORDER BY u.last_name, u.first_name`,
    [yearId, role],
  );
  return rows;
}

export type Missing = { id: number; title: string; block: string; day: string; organizer: string; email: string; phone: string };

// Sessioni già concluse (giorno + fine dell'ultimo blocco, ora di Zurigo) con iscritti e nessuna presenza segnata.
// Solo visualizzazione nel sito: nessuna mail automatica.
export async function missingAttendance(pool: Pool, now: Date = new Date()): Promise<Missing[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, b.name AS block, to_char(d.day, 'DD.MM.YYYY') AS day,
            u.first_name || ' ' || u.last_name AS organizer, u.login_id AS email, a.contact AS phone
     FROM activity_sessions s
     JOIN activities a ON a.id = s.activity_id AND a.status = 'approvata'
     JOIN school_years y ON y.id = a.school_year_id AND y.is_current
     JOIN users u ON u.id = a.organizer_id
     JOIN time_blocks b ON b.id = s.start_block_id
     JOIN ga_days d ON d.id = s.ga_day_id AND d.day IS NOT NULL
     JOIN LATERAL (SELECT max(tb.end_time) AS t FROM session_blocks sb JOIN time_blocks tb ON tb.id = sb.block_id WHERE sb.session_id = s.id) e ON true
     WHERE d.day + e.t < ($1::timestamptz AT TIME ZONE 'Europe/Zurich')
       AND EXISTS (SELECT 1 FROM enrollments x WHERE x.session_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM enrollments x WHERE x.session_id = s.id AND x.present IS NOT NULL)
     ORDER BY d.day, b.position, a.title`,
    [now],
  );
  return rows;
}

// Pagina "Gestione GA": ogni sezione è un blocco di HTML; flash = messaggio dell'ultima azione.
export async function managePage(pool: Pool, flash = ''): Promise<string> {
  const state = await getEnrollState(pool);
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const [missing, activities, relatori, docenti] = await Promise.all([
    missingAttendance(pool),
    listActivities(pool, year),
    listPeople(pool, year, 'relatore'),
    listPeople(pool, year, 'docente'),
  ]);
  const years = await listSchoolYears(pool);
  const table = (head: string[], rows: string[]) =>
    `<table border="1" cellpadding="6" style="border-collapse:collapse"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
  const STATUS: Record<string, string> = { proposta: 'proposta', approvata: 'approvata', rifiutata: 'rifiutata' };
  const people = (list: Person[]) =>
    list.length
      ? table(['Nome', 'Contatto', 'Attività'], list.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}${p.phone ? ` · ${esc(p.phone)}` : ''}</td><td>${p.titles.map(esc).join(', ')}</td></tr>`))
      : '<p>Nessuno.</p>';
  const sent = (await pool.query('SELECT enrollment_mail_sent_at IS NOT NULL AS sent FROM school_years WHERE is_current')).rows[0].sent;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Gestione GA</title></head><body>
<h1>Gestione GA</h1>
${flash}
<h2>Iscrizioni</h2>
<p>Stato attuale: <strong>${STATES[state]}</strong></p>
<form method="post" action="/gestione-ga/stato"><p><select name="state" aria-label="Stato">${Object.entries(STATES)
    .map(([k, l]) => `<option value="${k}"${k === state ? ' selected' : ''}>${l}</option>`)
    .join('')}</select> <button>Imposta lo stato</button></p></form>
<form method="post" action="/gestione-ga/apri" onsubmit="return confirm('Aprire le iscrizioni a tutti e inviare la mail a tutti gli allievi e docenti registrati?')">
<p><button>Apri le iscrizioni</button>${
    sent ? ' <label><input type="checkbox" name="resend" value="1"> la mail è già stata inviata: reinvia comunque</label>' : ''
  }</p></form>
<h2>Assegnazione casuale</h2>${
    state === 'chiuse'
      ? `<form method="post" action="/gestione-ga/assegna"><p><button name="action" value="preview">Anteprima</button>
<button name="action" value="confirm" onclick="return confirm('Assegnare a caso gli allievi senza iscrizione?')">Assegna a caso</button>
<label><input type="checkbox" name="partial" value="1"> assegna comunque anche se alcuni posti non bastano</label>
<button name="action" value="undo" onclick="return confirm('Annullare tutte le assegnazioni casuali?')">Annulla le assegnazioni</button></p></form>`
      : '<p>Disponibile quando le iscrizioni sono chiuse.</p>'
  }
<h2>Attività</h2>
${
    activities.length
      ? table(
          ['Attività', 'Stato', 'Blocco', 'Aula', 'Iscritti / max', 'Organizzatore'],
          activities.map((a) => {
            const low = a.status === 'approvata' && a.sessions.some((x) => x.n < a.min);
            return `<tr><td><a href="/attivita/${a.id}">${esc(a.title)}</a></td><td>${STATUS[a.status] ?? esc(a.status)}</td><td>${
              a.sessions.map((x) => esc(x.block) + (x.day ? ` ${x.day}` : '')).join('<br>') || '—'
            }</td><td>${a.room ? esc(a.room) : 'da definire'}</td><td>${a.sessions.map((x) => `${x.n}/${a.max}`).join('<br>') || '—'}${
              low ? ` <strong>sotto il minimo (${a.min})</strong>` : ''
            }</td><td>${esc(a.organizer)}</td></tr>`;
          }),
        )
      : '<p>Nessuna attività.</p>'
  }
<h2>Relatori</h2>${people(relatori)}
<h2>Docenti</h2>${people(docenti)}
<h2>Esporta</h2>
<form method="get" action="/gestione-ga/export"><p>
<select name="what" aria-label="Cosa">${[['attivita', 'Attività'], ['allievi', 'Allievi (classe e programma)'], ['relatori', 'Relatori'], ['docenti', 'Docenti'], ['presenze', 'Presenze']]
    .map(([k, l]) => `<option value="${k}">${l}</option>`)
    .join('')}</select>
<select name="fmt" aria-label="Formato"><option value="xlsx">XLSX</option><option value="csv">CSV</option></select>
<select name="anno" aria-label="Anno">${years.map((y) => `<option value="${y.id}"${y.is_current ? ' selected' : ''}>${esc(y.name)}</option>`).join('')}</select></p>
<p><small>Filtri per attività e presenze:</small>
<select name="kind" aria-label="Organizzatore"><option value="">Tutti gli organizzatori</option><option value="allievo">Solo di allievi</option><option value="docente">Solo di docenti</option><option value="relatore">Solo di relatori</option></select>
<select name="ids" multiple size="4" aria-label="Attività scelte" title="Tieni premuto Ctrl per sceglierne più d'una">${activities.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select>
<small>Filtro per allievi:</small> <input name="classe" placeholder="Classe (es. I3A)" size="10">
<button>Scarica</button></p></form>
<h2>Presenze mancanti</h2>
${
    missing.length
      ? `<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Attività</th><th>Quando</th><th>Organizzatore</th><th>Contatto</th></tr>${missing
          .map(
            (m) => `<tr><td><a href="/attivita/${m.id}">${esc(m.title)}</a></td><td>${m.day} · ${esc(m.block)}</td><td>${esc(m.organizer)}</td><td>${esc(m.email)}${m.phone ? ` · ${esc(m.phone)}` : ''}</td></tr>`,
          )
          .join('')}</table>`
      : '<p>Nessuna attività conclusa senza presenze.</p>'
  }
</body></html>`;
}

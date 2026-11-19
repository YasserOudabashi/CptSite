import { Pool } from 'pg';
import { esc } from '../ui/layout';
import { STATES, getEnrollState } from './enroll';

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
  const missing = await missingAttendance(pool);
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

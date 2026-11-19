import { Pool } from 'pg';
import { STATES, getEnrollState } from './enroll';

// Pagina "Gestione GA": ogni sezione è un blocco di HTML; flash = messaggio dell'ultima azione.
export async function managePage(pool: Pool, flash = ''): Promise<string> {
  const state = await getEnrollState(pool);
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
</body></html>`;
}

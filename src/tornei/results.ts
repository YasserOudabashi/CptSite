import { Pool, PoolClient } from 'pg';
import { esc } from '../ui/layout';
import { MatchRow } from './matches';
import { Tournament, User, isOrganizer } from './service';

export type ResultInput = {
  status?: string;
  home_score?: string;
  away_score?: string;
  sets?: string[]; // "25-20", uno per set
  forfeit?: string; // 'home' | 'away' = vince a tavolino quella squadra
  winner?: string; // 'home' | 'away' (pareggio nell'eliminazione)
  note?: string;
};

// Solo l'arbitro della partita e gli organizzatori del torneo: nessuna scorciatoia per ruolo, nemmeno per i responsabili.
export async function canEnter(pool: Pool | PoolClient, user: User | undefined, tid: number, m: { referee_id: number | null }): Promise<boolean> {
  if (!user) return false;
  return m.referee_id === user.id || (await isOrganizer(pool as Pool, tid, user.id));
}

const num = (v: unknown, label: string): number => {
  const n = Number(String(v ?? '').trim());
  if (String(v ?? '').trim() === '' || !Number.isInteger(n) || n < 0 || n > 999) throw new Error(`${label}: serve un numero intero da 0 a 999.`);
  return n;
};

// Set al meglio di N: vince chi ne ottiene la maggioranza e la partita finisce lì; nessun set pari.
export function parseSets(lines: string[], bestOf: number, complete: boolean): { h: number; a: number; text: string | null } {
  const sets = lines.map((l) => l.trim()).filter(Boolean);
  if (sets.length > bestOf) throw new Error(`Al massimo ${bestOf} set.`);
  let h = 0;
  let a = 0;
  const need = Math.ceil(bestOf / 2);
  for (const [i, s] of sets.entries()) {
    const m = /^(\d{1,3})\s*[-–:]\s*(\d{1,3})$/.exec(s);
    if (!m) throw new Error(`Set ${i + 1}: scrivi i punti come 25-20.`);
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x === y) throw new Error(`Set ${i + 1}: il set non può finire in parità.`);
    if (h === need || a === need) throw new Error('Ci sono set dopo la fine della partita.');
    if (x > y) h++;
    else a++;
  }
  if (complete && h !== need && a !== need) throw new Error(`Una partita al meglio di ${bestOf} set finisce quando una squadra vince ${need} set.`);
  return { h, a, text: sets.length ? sets.map((s) => s.replace(/\s/g, '').replace(/[–:]/, '-')).join(',') : null };
}

export async function saveResult(pool: Pool, user: User, tid: number, matchId: number, b: ResultInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query<Tournament>('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [tid])).rows[0];
    const m = (await client.query<MatchRow>('SELECT * FROM tournament_matches WHERE id = $1 AND tournament_id = $2 FOR UPDATE', [matchId, tid])).rows[0];
    if (!t || !m) throw new Error('Partita non trovata.');
    if (!(await canEnter(client, user, tid, m))) throw new Error('Solo l\'arbitro della partita e gli organizzatori inseriscono i risultati.');
    if (t.status !== 'in corso') throw new Error('Il torneo non è in corso.');
    const status = String(b.status ?? '');
    if (!['da giocare', 'in corso', 'finita', 'annullata'].includes(status)) throw new Error('Stato non valido.');
    if ((status === 'in corso' || status === 'finita') && (!m.home_id || !m.away_id)) throw new Error('Le due squadre non sono ancora note.');
    const ko = m.stage === 'eliminazione';
    let hs: number | null = null;
    let as: number | null = null;
    let sets: string | null = null;
    let winner: number | null = null;
    let forfeit = false;
    const side = (s: unknown) => (s === 'home' ? m.home_id : s === 'away' ? m.away_id : null);
    if (status === 'finita' && (b.forfeit === 'home' || b.forfeit === 'away')) {
      forfeit = true;
      winner = side(b.forfeit);
      hs = b.forfeit === 'home' ? t.forfeit_score : 0;
      as = b.forfeit === 'away' ? t.forfeit_score : 0;
    } else if (status === 'in corso' || status === 'finita') {
      const done = status === 'finita';
      if (t.score_type === 'set') {
        const r = parseSets(b.sets ?? [], t.best_of, done);
        hs = r.h;
        as = r.a;
        sets = r.text;
      } else if (done || String(b.home_score ?? '').trim() || String(b.away_score ?? '').trim()) {
        hs = num(b.home_score, 'Punti squadra di casa');
        as = num(b.away_score, 'Punti squadra ospite');
      }
      if (done) {
        winner = hs! > as! ? m.home_id : as! > hs! ? m.away_id : null;
        if (winner === null) {
          if (!ko) {
            if (t.score_type === 'set') throw new Error('Nelle partite a set non c\'è il pareggio.');
          } else {
            winner = side(b.winner);
            if (!winner) throw new Error('Nelle partite a eliminazione il pareggio non è ammesso: indica chi vince (supplementari o rigori) e scrivi una nota.');
            if (!String(b.note ?? '').trim()) throw new Error('Scrivi una nota sul modo in cui è stato deciso (supplementari, rigori…).');
          }
        }
      }
    }
    const note = String(b.note ?? '').trim().slice(0, 300);
    const prev = { status: m.status, home_score: m.home_score, away_score: m.away_score, sets: m.sets, winner_id: m.winner_id, forfeit: m.forfeit, note: m.note };
    await client.query('INSERT INTO tournament_result_log (match_id, user_id, previous) VALUES ($1,$2,$3)', [matchId, user.id, JSON.stringify(prev)]);
    await client.query(
      `UPDATE tournament_matches SET status = $2, home_score = $3, away_score = $4, sets = $5, winner_id = $6, forfeit = $7, note = $8 WHERE id = $1`,
      [matchId, status, hs, as, sets, winner, forfeit, note],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function addEvent(pool: Pool, user: User, tid: number, matchId: number, userId: number, kind: string): Promise<void> {
  const m = (await pool.query<{ referee_id: number | null; home_id: number | null; away_id: number | null }>('SELECT referee_id, home_id, away_id FROM tournament_matches WHERE id = $1 AND tournament_id = $2', [matchId, tid])).rows[0];
  if (!m || !(await canEnter(pool, user, tid, m))) throw new Error('Solo l\'arbitro della partita e gli organizzatori registrano gli eventi.');
  if (!['gol', 'giallo', 'rosso'].includes(kind)) throw new Error('Evento non valido.');
  const ok = await pool.query('SELECT 1 FROM tournament_members WHERE user_id = $1 AND team_id IN ($2,$3) AND confirmed', [userId, m.home_id, m.away_id]);
  if (!ok.rowCount) throw new Error('Il giocatore non è in una delle due squadre.');
  await pool.query('INSERT INTO tournament_match_events (match_id, tournament_id, user_id, kind) VALUES ($1,$2,$3,$4)', [matchId, tid, userId, kind]);
}

export async function removeEvent(pool: Pool, user: User, tid: number, matchId: number, eventId: number): Promise<void> {
  const m = (await pool.query<{ referee_id: number | null }>('SELECT referee_id FROM tournament_matches WHERE id = $1 AND tournament_id = $2', [matchId, tid])).rows[0];
  if (!m || !(await canEnter(pool, user, tid, m))) throw new Error('Solo l\'arbitro della partita e gli organizzatori registrano gli eventi.');
  await pool.query('DELETE FROM tournament_match_events WHERE id = $1 AND match_id = $2', [eventId, matchId]);
}

// Pagina del risultato: modulo adatto al tipo di punteggio, eventi e storico delle correzioni.
export async function resultPage(pool: Pool, t: Tournament, m: MatchRow): Promise<string> {
  const log = (
    await pool.query<{ at: Date; who: string; previous: string }>(
      `SELECT l.at, u.first_name || ' ' || u.last_name AS who, l.previous FROM tournament_result_log l JOIN users u ON u.id = l.user_id WHERE l.match_id = $1 ORDER BY l.id DESC`,
      [m.id],
    )
  ).rows;
  const events = (
    await pool.query<{ id: number; kind: string; who: string; team: string }>(
      `SELECT e.id, e.kind, u.first_name || ' ' || u.last_name AS who, tt.name AS team FROM tournament_match_events e JOIN users u ON u.id = e.user_id
       JOIN tournament_members tm ON tm.user_id = e.user_id AND tm.tournament_id = e.tournament_id JOIN tournament_teams tt ON tt.id = tm.team_id WHERE e.match_id = $1 ORDER BY e.id`,
      [m.id],
    )
  ).rows;
  const players = (
    await pool.query<{ id: number; who: string; team: string }>(
      `SELECT u.id, u.first_name || ' ' || u.last_name AS who, tt.name AS team FROM tournament_members tm JOIN users u ON u.id = tm.user_id JOIN tournament_teams tt ON tt.id = tm.team_id
       WHERE tm.confirmed AND tm.team_id IN ($1,$2) ORDER BY tt.name, u.last_name`,
      [m.home_id, m.away_id],
    )
  ).rows;
  const sel = (v: string, o: string) => (v === o ? ' selected' : '');
  const ff = m.forfeit ? (m.winner_id === m.home_id ? 'home' : 'away') : '';
  const setLines = (m.sets ?? '').split(',');
  const score =
    t.score_type === 'set'
      ? Array.from({ length: t.best_of }, (_, i) => `<p><label>Set ${i + 1} (es. 25-20) <input name="sets" value="${esc(setLines[i] ?? '')}" pattern="\\d{1,3}\\s*[-–:]\\s*\\d{1,3}|"></label></p>`).join('')
      : `<p><label>${esc(m.home ?? 'Casa')} <input type="number" name="home_score" min="0" value="${m.home_score ?? ''}"></label> – <label>${esc(m.away ?? 'Ospite')} <input type="number" name="away_score" min="0" value="${m.away_score ?? ''}"></label></p>`;
  const stato = (s: string) => `<option${sel(m.status, s)}>${s}</option>`;
  return `<h1>${esc(m.home ?? 'Da definire')} – ${esc(m.away ?? 'Da definire')}</h1>
<form method="post" action="/tornei/${t.id}/partite/${m.id}/risultato">
<p><label>Stato <select name="status">${['da giocare', 'in corso', 'finita', 'annullata'].map(stato).join('')}</select></label></p>
${score}
<p><label>Vittoria a tavolino (forfait, ${t.forfeit_score}–0) <select name="forfeit"><option value="">no</option><option value="home"${sel(ff, 'home')}>vince ${esc(m.home ?? 'casa')}</option><option value="away"${sel(ff, 'away')}>vince ${esc(m.away ?? 'ospite')}</option></select></label></p>
${m.stage === 'eliminazione' ? `<p><label>Se è pari, vince <select name="winner"><option value="">—</option><option value="home">${esc(m.home ?? 'casa')}</option><option value="away">${esc(m.away ?? 'ospite')}</option></select></label> (serve una nota: supplementari, rigori…)</p>` : ''}
<p><label>Nota <input name="note" maxlength="300" value="${esc(m.note)}" size="50"></label></p>
<p><button>Salva il risultato</button></p></form>
<h2>Eventi (facoltativi)</h2>
<ul>${events.map((e) => `<li>${esc(e.kind)}: ${esc(e.who)} (${esc(e.team)}) <form method="post" action="/tornei/${t.id}/partite/${m.id}/eventi/${e.id}/togli" style="display:inline"><button>Togli</button></form></li>`).join('') || '<li>Nessuno</li>'}</ul>
<form method="post" action="/tornei/${t.id}/partite/${m.id}/eventi"><p><select name="user" aria-label="Giocatore">${players.map((p) => `<option value="${p.id}">${esc(p.who)} (${esc(p.team)})</option>`).join('')}</select>
<select name="kind"><option value="gol">gol/punto</option><option value="giallo">cartellino giallo</option><option value="rosso">cartellino rosso</option></select> <button>Aggiungi</button></p></form>
<h2>Correzioni</h2>
<ul>${log.map((l) => `<li>${l.at.toLocaleString('it-CH', { timeZone: 'Europe/Zurich' })} · ${esc(l.who)} · prima: ${esc(l.previous)}</li>`).join('') || '<li>Nessuna</li>'}</ul>`;
}

export async function loadMatch(pool: Pool, tid: number, id: number): Promise<MatchRow | undefined> {
  return (
    await pool.query<MatchRow>(
      `SELECT m.*, h.name AS home, a.name AS away FROM tournament_matches m LEFT JOIN tournament_teams h ON h.id = m.home_id LEFT JOIN tournament_teams a ON a.id = m.away_id WHERE m.id = $1 AND m.tournament_id = $2`,
      [id, tid],
    )
  ).rows[0];
}

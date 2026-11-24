import { Pool, PoolClient } from 'pg';
import { Row, standings } from './standings';
import { Tournament } from './service';

type Q = Pool | PoolClient;

// Classifica di ogni girone dai risultati delle partite finite (non annullate).
export async function groupStandings(db: Q, t: Tournament): Promise<{ id: number; name: string; rows: (Row & { name: string })[]; complete: boolean }[]> {
  const groups = (await db.query<{ id: number; name: string }>('SELECT id, name FROM tournament_groups WHERE tournament_id = $1 ORDER BY id', [t.id])).rows;
  const teams = (await db.query<{ id: number; name: string; group_id: number; draw_no: number | null }>('SELECT id, name, group_id, draw_no FROM tournament_teams WHERE tournament_id = $1 AND group_id IS NOT NULL', [t.id])).rows;
  const ms = (await db.query<{ group_id: number; home_id: number; away_id: number; home_score: number | null; away_score: number | null; status: string }>(
    `SELECT group_id, home_id, away_id, home_score, away_score, status FROM tournament_matches WHERE tournament_id = $1 AND stage = 'girone'`,
    [t.id],
  )).rows;
  return groups.map((g) => {
    const gt = teams.filter((x) => x.group_id === g.id);
    const gm = ms.filter((m) => m.group_id === g.id);
    const played = gm.filter((m) => m.status === 'finita' && m.home_score != null && m.away_score != null).map((m) => ({ home: m.home_id, away: m.away_id, hs: m.home_score!, as: m.away_score! }));
    const rows = standings(gt.map((x) => x.id), played, t, new Map(gt.map((x) => [x.id, x.draw_no ?? x.id])));
    const names = new Map(gt.map((x) => [x.id, x.name]));
    return { id: g.id, name: g.name, rows: rows.map((r) => ({ ...r, name: names.get(r.team)! })), complete: gm.length > 0 && gm.every((m) => m.status === 'finita' || m.status === 'annullata') };
  });
}

const started = 'Il turno successivo è già iniziato: il risultato non si può più cambiare.';

// Dopo ogni salvataggio: il vincitore avanza nel tabellone; a gironi conclusi le qualificate entrano nella fase a eliminazione.
// Se la partita successiva è già iniziata si rifiuta (e la transazione di chi chiama torna indietro).
export async function propagate(client: PoolClient, t: Tournament, matchId: number): Promise<void> {
  const m = (await client.query<{ stage: string; status: string; winner_id: number | null; next_match_id: number | null; next_slot: 'home' | 'away' | null }>(
    'SELECT stage, status, winner_id, next_match_id, next_slot FROM tournament_matches WHERE id = $1',
    [matchId],
  )).rows[0];
  if (m.stage === 'eliminazione') {
    if (!m.next_match_id) return;
    const team = m.status === 'finita' ? m.winner_id : null;
    const next = (await client.query<{ status: string; home_id: number | null; away_id: number | null }>('SELECT status, home_id, away_id FROM tournament_matches WHERE id = $1 FOR UPDATE', [m.next_match_id])).rows[0];
    const cur = m.next_slot === 'home' ? next.home_id : next.away_id;
    if (cur === team) return;
    if (next.status !== 'da giocare') throw new Error(started);
    await client.query(`UPDATE tournament_matches SET ${m.next_slot === 'home' ? 'home_id' : 'away_id'} = $2 WHERE id = $1`, [m.next_match_id, team]);
    return;
  }
  if (t.format !== 'gironi_eliminazione') return;
  const groups = await groupStandings(client, t);
  const wanted = new Map<string, number>();
  if (groups.every((g) => g.complete)) for (const g of groups) g.rows.forEach((r, i) => wanted.set(`G${g.id}:${i + 1}`, r.team));
  const ko = (await client.query<{ id: number; status: string; home_id: number | null; away_id: number | null; home_src: string | null; away_src: string | null }>(
    `SELECT id, status, home_id, away_id, home_src, away_src FROM tournament_matches WHERE tournament_id = $1 AND stage = 'eliminazione' AND (home_src IS NOT NULL OR away_src IS NOT NULL) FOR UPDATE`,
    [t.id],
  )).rows;
  for (const k of ko) {
    const h = k.home_src ? wanted.get(k.home_src) ?? null : k.home_id;
    const a = k.away_src ? wanted.get(k.away_src) ?? null : k.away_id;
    if (h === k.home_id && a === k.away_id) continue;
    if (k.status !== 'da giocare') throw new Error('La fase a eliminazione è già iniziata: il risultato del girone non si può più cambiare.');
    await client.query('UPDATE tournament_matches SET home_id = $2, away_id = $3 WHERE id = $1', [k.id, h, a]);
  }
}

// Classifica marcatori: gol/punti registrati come eventi.
export async function scorers(db: Q, tid: number): Promise<{ who: string; team: string; goals: number }[]> {
  return (await db.query<{ who: string; team: string; goals: number }>(
    `SELECT u.first_name || ' ' || u.last_name AS who, tt.name AS team, count(*)::int AS goals
     FROM tournament_match_events e JOIN users u ON u.id = e.user_id
     JOIN tournament_members tm ON tm.user_id = e.user_id AND tm.tournament_id = e.tournament_id JOIN tournament_teams tt ON tt.id = tm.team_id
     WHERE e.tournament_id = $1 AND e.kind = 'gol' GROUP BY u.id, tt.name ORDER BY goals DESC, who`,
    [tid],
  )).rows;
}

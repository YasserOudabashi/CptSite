import { Pool } from 'pg';
import { getCurrentSchoolYear } from '../users/roles';
import { groupStandings, scorers } from './advance';
import { loadMatches, roundName, slotLabel } from './matches';
import { Tournament, User, canManage, getTournament } from './service';
import { listTeams } from './teams';

export const WHAT = ['squadre', 'calendario', 'risultati', 'classifiche', 'marcatori'] as const;
export type What = (typeof WHAT)[number];

const zone = (d: Date | null, o: Intl.DateTimeFormatOptions) => (d ? d.toLocaleString('sv-SE', { timeZone: 'Europe/Zurich', ...o }) : '');
const day = (d: Date | null) => zone(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
const hour = (d: Date | null) => zone(d, { hour: '2-digit', minute: '2-digit' });

// Righe (prima riga = intestazioni) da passare a toCsv / toXlsx.
export async function exportRows(pool: Pool, t: Tournament, what: What): Promise<string[][]> {
  if (what === 'squadre') {
    const groups = new Map((await pool.query<{ id: number; name: string }>('SELECT id, name FROM tournament_groups WHERE tournament_id = $1', [t.id])).rows.map((g) => [g.id, g.name]));
    return [
      ['Squadra', 'Giocatori', 'Girone', 'Accettata a mano', 'Testa di serie'],
      ...(await listTeams(pool, t)).map((x) => [x.name, x.members.filter((m) => m.confirmed).map((m) => m.name).join(', '), groups.get(x.group_id ?? 0) ?? '', x.approved ? 'sì' : '', x.seed_no ? String(x.seed_no) : '']),
    ];
  }
  if (what === 'classifiche') {
    const rows: string[][] = [['Girone', 'Posizione', 'Squadra', 'Giocate', 'Vinte', 'Pareggiate', 'Perse', 'Fatti', 'Subiti', 'Differenza', 'Punti']];
    for (const g of await groupStandings(pool, t)) g.rows.forEach((r, i) => rows.push([g.name, String(i + 1), r.name, ...[r.played, r.won, r.drawn, r.lost, r.gf, r.ga, r.diff, r.points].map(String)]));
    return rows;
  }
  if (what === 'marcatori') return [['Giocatore', 'Squadra', 'Gol/punti'], ...(await scorers(pool, t.id)).map((r) => [r.who, r.team, String(r.goals)])];
  const all = await loadMatches(pool, t.id);
  const groups = new Map((await pool.query<{ id: number; name: string }>('SELECT id, name FROM tournament_groups WHERE tournament_id = $1', [t.id])).rows.map((g) => [g.id, g.name]));
  const team = (n: string | null, s: string | null) => slotLabel(n, s, groups);
  if (what === 'calendario') {
    return [
      ['Fase', 'Turno', 'Casa', 'Ospite', 'Data', 'Ora', 'Campo', 'Arbitro', 'Rinvio'],
      ...all.map((m) => [m.group_name ?? 'Eliminazione', roundName(all, m), team(m.home, m.home_src), team(m.away, m.away_src), day(m.starts_at), hour(m.starts_at), m.field ?? '', m.referee ?? '', m.postponed_reason ?? '']),
    ];
  }
  return [
    ['Fase', 'Turno', 'Casa', 'Ospite', 'Punti casa', 'Punti ospite', 'Set', 'Stato', 'A tavolino', 'Nota'],
    ...all
      .filter((m) => m.status !== 'da giocare')
      .map((m) => [m.group_name ?? 'Eliminazione', roundName(all, m), team(m.home, m.home_src), team(m.away, m.away_src), m.home_score == null ? '' : String(m.home_score), m.away_score == null ? '' : String(m.away_score), m.sets ?? '', m.status, m.forfeit ? 'sì' : '', m.note]),
  ];
}

// Duplica da un anno precedente: regolamento, formato, punteggio e campi; niente squadre, partite, arbitri.
export async function duplicateTournament(pool: Pool, user: User, fromId: number): Promise<number> {
  const src = await getTournament(pool, fromId);
  if (!src || !(await canManage(pool, user, fromId))) throw new Error('Non puoi duplicare questo torneo.');
  if (src.is_current) throw new Error('Si duplicano i tornei degli anni precedenti.');
  const y = await getCurrentSchoolYear(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO tournaments (school_year_id, created_by, name, sport, description, rules, mode, team_min, team_max, format, double_round, groups_count, qualifiers,
                                score_type, best_of, pts_win, pts_draw, pts_loss, forfeit_score, tiebreaks, match_minutes, max_teams)
       SELECT $2, $3, name, sport, description, rules, mode, team_min, team_max, format, double_round, groups_count, qualifiers,
              score_type, best_of, pts_win, pts_draw, pts_loss, forfeit_score, tiebreaks, match_minutes, max_teams FROM tournaments WHERE id = $1 RETURNING id`,
      [fromId, y.id, user.id],
    );
    await client.query('INSERT INTO tournament_fields (tournament_id, name) SELECT $2, name FROM tournament_fields WHERE tournament_id = $1', [fromId, rows[0].id]);
    await client.query('INSERT INTO tournament_organizers (tournament_id, user_id) VALUES ($1,$2)', [rows[0].id, user.id]);
    await client.query('COMMIT');
    return rows[0].id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

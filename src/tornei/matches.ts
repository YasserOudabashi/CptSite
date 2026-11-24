import { Pool } from 'pg';

export interface MatchRow {
  id: number;
  stage: 'girone' | 'eliminazione';
  group_id: number | null;
  group_name: string | null;
  round: number;
  pos: number;
  home_id: number | null;
  away_id: number | null;
  home: string | null;
  away: string | null;
  home_src: string | null;
  away_src: string | null;
  field_id: number | null;
  field: string | null;
  starts_at: Date | null;
  referee_id: number | null;
  referee: string | null;
  status: 'da giocare' | 'in corso' | 'finita' | 'annullata';
  home_score: number | null;
  away_score: number | null;
  sets: string | null;
  winner_id: number | null;
  forfeit: boolean;
  note: string;
  postponed_reason: string | null;
  next_match_id: number | null;
  next_slot: 'home' | 'away' | null;
}

export async function loadMatches(pool: Pool, tid: number): Promise<MatchRow[]> {
  return (
    await pool.query<MatchRow>(
      `SELECT m.*, g.name AS group_name, h.name AS home, a.name AS away, f.name AS field, r.first_name || ' ' || r.last_name AS referee
       FROM tournament_matches m
       LEFT JOIN tournament_groups g ON g.id = m.group_id
       LEFT JOIN tournament_teams h ON h.id = m.home_id
       LEFT JOIN tournament_teams a ON a.id = m.away_id
       LEFT JOIN tournament_fields f ON f.id = m.field_id
       LEFT JOIN users r ON r.id = m.referee_id
       WHERE m.tournament_id = $1
       ORDER BY m.stage, m.starts_at NULLS LAST, m.round, m.pos, m.id`,
      [tid],
    )
  ).rows;
}

const ROUNDS = ['Finale', 'Semifinali', 'Quarti di finale', 'Ottavi di finale'];
// Nome del turno a eliminazione contando dalla fine.
export function roundName(matches: MatchRow[], m: MatchRow): string {
  if (m.stage === 'girone') return `Turno ${m.round}`;
  const last = Math.max(...matches.filter((x) => x.stage === 'eliminazione').map((x) => x.round));
  return ROUNDS[last - m.round] ?? `Turno ${m.round}`;
}

// Nome della squadra, oppure da dove arriva (es. "1° Girone A") se non è ancora nota.
export function slotLabel(name: string | null, src: string | null, groups: Map<number, string>): string {
  if (name) return name;
  const s = /^G(\d+):(\d+)$/.exec(src ?? '');
  return s ? `${s[2]}° ${groups.get(Number(s[1])) ?? 'girone'}` : 'Da definire';
}

import { Pool } from 'pg';
import { esc } from '../ui/layout';
import { fmtWhen } from './ui';

export interface MyMatch {
  id: number;
  tournament_id: number;
  tournament: string;
  starts_at: Date | null;
  status: string;
  field: string | null;
  referee: string | null;
  postponed_reason: string | null;
  role: 'arbitro' | 'giocatore';
  home: string | null;
  away: string | null;
  opponent: string | null;
}

// Prossime partite dell'utente (come giocatore o come arbitro) nei tornei dell'anno corrente non in bozza; le finite e le annullate no.
export async function myMatches(pool: Pool, userId: number, limit = 50): Promise<MyMatch[]> {
  return (
    await pool.query<MyMatch>(
      `SELECT m.id, m.tournament_id, t.name AS tournament, m.starts_at, m.status, m.postponed_reason, f.name AS field, r.first_name || ' ' || r.last_name AS referee,
              CASE WHEN m.referee_id = $1 THEN 'arbitro' ELSE 'giocatore' END AS role, h.name AS home, a.name AS away,
              CASE WHEN tm.team_id = m.home_id THEN a.name ELSE h.name END AS opponent
       FROM tournament_matches m
       JOIN tournaments t ON t.id = m.tournament_id JOIN school_years y ON y.id = t.school_year_id
       LEFT JOIN tournament_members tm ON tm.tournament_id = m.tournament_id AND tm.user_id = $1 AND tm.confirmed AND tm.team_id IN (m.home_id, m.away_id)
       LEFT JOIN tournament_teams h ON h.id = m.home_id LEFT JOIN tournament_teams a ON a.id = m.away_id
       LEFT JOIN tournament_fields f ON f.id = m.field_id LEFT JOIN users r ON r.id = m.referee_id
       WHERE y.is_current AND t.status <> 'bozza' AND m.status IN ('da giocare', 'in corso') AND (tm.user_id IS NOT NULL OR m.referee_id = $1)
       ORDER BY m.status = 'in corso' DESC, m.starts_at NULLS LAST, m.id LIMIT $2`,
      [userId, limit],
    )
  ).rows;
}

export function myMatchesHtml(rows: MyMatch[]): string {
  return `<ul>${rows
    .map(
      (m) => `<li${m.status === 'in corso' ? ' style="background:#ffd54f55;border-radius:.25rem;padding:.1rem .3rem"' : ''}><strong>${fmtWhen(m.starts_at)}</strong> · <a href="/tornei/${m.tournament_id}">${esc(m.tournament)}</a> ·
${m.role === 'arbitro' ? `arbitri ${esc(m.home ?? 'da definire')} – ${esc(m.away ?? 'da definire')}` : `contro ${esc(m.opponent ?? 'da definire')}`}
${m.field ? `· campo: ${esc(m.field)}` : '· campo da definire'}${m.role === 'giocatore' && m.referee ? ` · arbitro: ${esc(m.referee)}` : ''}${m.status === 'in corso' ? ' · <strong>IN CORSO</strong>' : ''}${m.postponed_reason ? ` · <em>rinviata: ${esc(m.postponed_reason)}</em>` : ''}</li>`,
    )
    .join('')}</ul>`;
}

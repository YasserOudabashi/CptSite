import { esc } from '../ui/layout';
import { MatchRow, roundName, slotLabel } from './matches';
import { fmtWhen } from './ui';
import type { Row } from './standings';

export const resultText = (m: MatchRow): string => {
  if (m.status === 'annullata') return 'annullata';
  if (m.home_score == null || m.away_score == null) return m.status === 'in corso' ? 'in corso' : '';
  return `${m.home_score}–${m.away_score}${m.sets ? ` (${esc(m.sets.replace(/,/g, ', '))})` : ''}${m.forfeit ? ' a tavolino' : ''}`;
};

// Una riga di calendario: squadre, turno, quando e dove, arbitro, risultato e motivo di un eventuale rinvio.
export function matchLine(m: MatchRow, all: MatchRow[], groups: Map<number, string>, edit = false): string {
  const h = esc(slotLabel(m.home, m.home_src, groups));
  const a = esc(slotLabel(m.away, m.away_src, groups));
  const live = m.status === 'in corso';
  return `<li data-match="${m.id}"${live ? ' style="background:#ffd54f55;border-radius:.25rem;padding:.1rem .3rem"' : ''}><strong>${h} – ${a}</strong> ${resultText(m) ? `<strong>${resultText(m)}</strong>` : ''}
<small>${esc(m.group_name ?? roundName(all, m))} · ${fmtWhen(m.starts_at)}${m.field ? ' · ' + esc(m.field) : ''}${m.referee ? ' · arbitro ' + esc(m.referee) : ''}${live ? ' · IN CORSO' : ''}${
    m.postponed_reason ? ` · <em>rinviata: ${esc(m.postponed_reason)}</em>` : ''}${m.note ? ` · ${esc(m.note)}` : ''}</small>${edit ? ` <a href="/tornei/${m.tournament_id}/partite/${m.id}">Risultato</a>` : ''}</li>`;
}

type G = { id: number; name: string; rows: (Row & { name: string })[]; complete: boolean };

export function standingsHtml(groups: G[], setMode: boolean): string {
  return groups
    .map(
      (g) => `<h3>${esc(g.name)}${g.complete ? '' : ' <small>(provvisoria)</small>'}</h3>
<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>N</th><th>P</th><th>${setMode ? 'SV' : 'GF'}</th><th>${setMode ? 'SP' : 'GS'}</th><th>DR</th><th>Pt</th></tr></thead><tbody>${g.rows
        .map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.diff}</td><td><strong>${r.points}</strong></td></tr>`)
        .join('')}</tbody></table></div>`,
    )
    .join('');
}

// Tabellone: un blocco per turno, dalla fase iniziale alla finale; i vincitori compaiono da soli nel turno dopo.
export function bracketHtml(matches: MatchRow[], groups: Map<number, string>): string {
  const ko = matches.filter((m) => m.stage === 'eliminazione');
  if (!ko.length) return '';
  const rounds = [...new Set(ko.map((m) => m.round))].sort((a, b) => a - b);
  return `<h3>Tabellone</h3><div class="bracket" style="display:flex;gap:1rem;overflow-x:auto">${rounds
    .map((r) => {
      const list = ko.filter((m) => m.round === r).sort((a, b) => a.pos - b.pos);
      return `<div style="min-width:12rem"><strong>${esc(roundName(matches, list[0]))}</strong>${list
        .map((m) => {
          const line = (name: string | null, src: string | null, score: number | null, win: boolean) =>
            `<div${win ? ' style="font-weight:bold"' : ''}>${esc(slotLabel(name, src, groups))}${score != null ? ` <span>${score}</span>` : ''}</div>`;
          const w = m.status === 'finita' ? m.winner_id : null;
          return `<div style="border:1px solid #8886;border-radius:.4rem;padding:.25rem .5rem;margin:.4rem 0">${line(m.home, m.home_src, m.home_score, !!w && w === m.home_id)}${line(m.away, m.away_src, m.away_score, !!w && w === m.away_id)}</div>`;
        })
        .join('')}</div>`;
    })
    .join('')}</div>`;
}

export function scorersHtml(rows: { who: string; team: string; goals: number }[]): string {
  if (!rows.length) return '';
  return `<h3>Marcatori</h3><ol>${rows.map((r) => `<li>${esc(r.who)} (${esc(r.team)}): ${r.goals}</li>`).join('')}</ol>`;
}

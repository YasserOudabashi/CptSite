import { esc } from '../ui/layout';
import { MatchRow, roundName, slotLabel } from './matches';
import { fmtWhen } from './ui';

export const resultText = (m: MatchRow): string => {
  if (m.status === 'annullata') return 'annullata';
  if (m.home_score == null || m.away_score == null) return m.status === 'in corso' ? 'in corso' : '';
  return `${m.home_score}–${m.away_score}${m.sets ? ` (${esc(m.sets.replace(/,/g, ', '))})` : ''}${m.forfeit ? ' a tavolino' : ''}`;
};

// Una riga di calendario: squadre, turno, quando e dove, arbitro, risultato e motivo di un eventuale rinvio.
export function matchLine(m: MatchRow, all: MatchRow[], groups: Map<number, string>): string {
  const h = esc(slotLabel(m.home, m.home_src, groups));
  const a = esc(slotLabel(m.away, m.away_src, groups));
  const live = m.status === 'in corso';
  return `<li data-match="${m.id}"${live ? ' style="background:#ffd54f55;border-radius:.25rem;padding:.1rem .3rem"' : ''}><strong>${h} – ${a}</strong> ${resultText(m) ? `<strong>${resultText(m)}</strong>` : ''}
<small>${esc(m.group_name ?? roundName(all, m))} · ${fmtWhen(m.starts_at)}${m.field ? ' · ' + esc(m.field) : ''}${m.referee ? ' · arbitro ' + esc(m.referee) : ''}${live ? ' · IN CORSO' : ''}${
    m.postponed_reason ? ` · <em>rinviata: ${esc(m.postponed_reason)}</em>` : ''}${m.note ? ` · ${esc(m.note)}` : ''}</small></li>`;
}

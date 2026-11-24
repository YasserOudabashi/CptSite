// Classifica di un girone dai risultati (funzione pura, testata in tests/tornei-standings.test.ts).

export type SMatch = { home: number; away: number; hs: number; as: number };
export type Rules = { pts_win: number; pts_draw: number; pts_loss: number; tiebreaks: string };
export type Row = { team: number; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; diff: number; points: number };

function table(teams: number[], matches: SMatch[], r: Rules): Map<number, Row> {
  const t = new Map(teams.map((id) => [id, { team: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, diff: 0, points: 0 }]));
  for (const m of matches) {
    const h = t.get(m.home);
    const a = t.get(m.away);
    if (!h || !a) continue;
    for (const [x, gf, ga] of [[h, m.hs, m.as], [a, m.as, m.hs]] as [Row, number, number][]) {
      x.played++;
      x.gf += gf;
      x.ga += ga;
      x.diff += gf - ga;
      if (gf > ga) (x.won++, (x.points += r.pts_win));
      else if (gf < ga) (x.lost++, (x.points += r.pts_loss));
      else (x.drawn++, (x.points += r.pts_draw));
    }
  }
  return t;
}

// Criteri in ordine (punti, scontro diretto, differenza, gol fatti, sorteggio): a ogni criterio le squadre ancora pari
// vengono riordinate con il criterio successivo. Lo scontro diretto vale solo tra le squadre pari a quel punto.
export function standings(teams: number[], matches: SMatch[], rules: Rules, draw: Map<number, number> = new Map()): Row[] {
  const all = table(teams, matches, rules);
  const byDraw = (a: number, b: number) => (draw.get(a) ?? a) - (draw.get(b) ?? b);
  const criteria = rules.tiebreaks.split(',').map((s) => s.trim()).filter(Boolean);
  const rank = (ids: number[], crit: string[]): number[] => {
    if (ids.length <= 1) return ids;
    if (!crit.length || crit[0] === 'sorteggio') return [...ids].sort(byDraw);
    let key: (id: number) => number;
    if (crit[0] === 'scontro_diretto') {
      const set = new Set(ids);
      const mini = table(ids, matches.filter((m) => set.has(m.home) && set.has(m.away)), rules);
      key = (id) => mini.get(id)!.points;
    } else if (crit[0] === 'punti') key = (id) => all.get(id)!.points;
    else if (crit[0] === 'differenza') key = (id) => all.get(id)!.diff;
    else if (crit[0] === 'fatti') key = (id) => all.get(id)!.gf;
    else return rank(ids, crit.slice(1)); // criterio sconosciuto: saltato
    const sorted = [...ids].sort((a, b) => key(b) - key(a));
    const out: number[] = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j < sorted.length && key(sorted[j]) === key(sorted[i])) j++;
      out.push(...rank(sorted.slice(i, j), crit.slice(1)));
      i = j;
    }
    return out;
  };
  return rank(teams, criteria).map((id) => all.get(id)!);
}

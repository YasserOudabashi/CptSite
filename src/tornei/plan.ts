// Generazione del calendario: funzioni pure (nessun database), testate in tests/tornei-plan.test.ts.

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], r: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Girone all'italiana col metodo del cerchio: ogni squadra incontra le altre una volta (due con il ritorno), con turni di riposo se dispari.
export function roundRobin(ids: number[], double: boolean): { round: number; home: number; away: number }[] {
  const list: (number | null)[] = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length;
  const out: { round: number; home: number; away: number }[] = [];
  const rounds = n - 1;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a === null || b === null) continue;
      // alterna casa/trasferta (il primo tavolo cambia a ogni turno)
      out.push(i === 0 && r % 2 ? { round: r + 1, home: b, away: a } : { round: r + 1, home: a, away: b });
    }
    list.splice(1, 0, list.pop()!); // ruota tenendo fermo il primo
  }
  if (double) for (const m of [...out]) out.push({ round: m.round + rounds, home: m.away, away: m.home });
  return out;
}

export type KoMatch = { round: number; pos: number; a: number | null; b: number | null; next?: { round: number; pos: number; slot: 'home' | 'away' } };

// Tabellone a eliminazione per n >= 2 squadre numerate per testa di serie 1..n. Se n non è potenza di 2,
// le teste di serie più alte hanno un turno di riposo: vanno già nel secondo turno (a/b preimpostati).
export function knockout(n: number): KoMatch[] {
  if (n < 2) return [];
  let size = 2;
  while (size < n) size *= 2;
  let order = [1, 2];
  while (order.length < size) order = order.flatMap((x) => [x, order.length * 2 + 1 - x]);
  const rounds = Math.log2(size);
  const out: KoMatch[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (let p = 1; p <= size / 2 ** r; p++) {
      out.push({ round: r, pos: p, a: null, b: null, next: r < rounds ? { round: r + 1, pos: Math.ceil(p / 2), slot: p % 2 ? 'home' : 'away' } : undefined });
    }
  }
  const find = (r: number, p: number) => out.find((m) => m.round === r && m.pos === p)!;
  const dropped = new Set<string>();
  for (let i = 0; i < size / 2; i++) {
    const a = order[2 * i];
    const b = order[2 * i + 1];
    const m = find(1, i + 1);
    if (b > n) {
      dropped.add(`1:${i + 1}`); // turno di riposo: a passa direttamente
      const t = find(2, Math.ceil((i + 1) / 2));
      if ((i + 1) % 2) t.a = a;
      else t.b = a;
    } else {
      m.a = a;
      m.b = b;
    }
  }
  return out.filter((m) => !dropped.has(`${m.round}:${m.pos}`));
}

// Distribuisce le squadre (già in ordine di testa di serie) nei gironi "a serpentina".
export function snake<T>(items: T[], k: number): T[][] {
  const g: T[][] = Array.from({ length: k }, () => []);
  items.forEach((x, i) => {
    const row = Math.floor(i / k);
    g[row % 2 ? k - 1 - (i % k) : i % k].push(x);
  });
  return g;
}

export type PlanTeam = { id: number; seed_no: number | null };
export type PlanMatch = {
  stage: 'girone' | 'eliminazione';
  group: number | null; // indice del girone
  round: number;
  pos: number;
  home: number | null;
  away: number | null;
  homeSrc?: string; // 'G<indice girone>:<posizione>'
  awaySrc?: string;
  next?: { round: number; pos: number; slot: 'home' | 'away' };
};
export type Plan = { groups: number[][]; draw: Map<number, number>; matches: PlanMatch[]; warnings: string[] };
export type PlanRules = { format: 'girone' | 'eliminazione' | 'gironi_eliminazione'; double_round: boolean; groups_count: number; qualifiers: number };

// Teste di serie scelte a mano per prime (per numero), le altre sorteggiate con il seme dato.
export function orderTeams(teams: PlanTeam[], r: () => number): number[] {
  const seeded = teams.filter((t) => t.seed_no != null).sort((a, b) => a.seed_no! - b.seed_no! || a.id - b.id);
  return [...seeded, ...shuffle(teams.filter((t) => t.seed_no == null), r)].map((t) => t.id);
}

export function buildPlan(rules: PlanRules, teams: PlanTeam[], seed: number): Plan {
  const r = rng(seed);
  if (teams.length < 2) throw new Error('Servono almeno 2 squadre valide.');
  const ordered = orderTeams(teams, r);
  const draw = new Map(shuffle(ordered, r).map((id, i) => [id, i + 1]));
  const matches: PlanMatch[] = [];
  const warnings: string[] = [];
  const koFrom = (slots: ({ team: number } | { src: string })[]) => {
    const bracket = knockout(slots.length);
    // Qualificate dello stesso girone al primo turno: si scambiano gli slot finché si può; se resta un accoppiamento si avvisa.
    const grp = (s: { team: number } | { src: string }) => ('src' in s ? s.src.split(':')[0] : null);
    const first = bracket.filter((m) => m.round === 1 && m.a != null && m.b != null);
    const bad = () => first.filter((m) => grp(slots[m.a! - 1]) !== null && grp(slots[m.a! - 1]) === grp(slots[m.b! - 1])).length;
    for (let guard = 0; guard < 50 && bad() > 0; guard++) {
      const m = first.find((x) => grp(slots[x.a! - 1]) !== null && grp(slots[x.a! - 1]) === grp(slots[x.b! - 1]))!;
      const before = bad();
      let fixed = false;
      for (let j = 0; j < slots.length && !fixed; j++) {
        if (j === m.a! - 1 || j === m.b! - 1) continue;
        [slots[m.b! - 1], slots[j]] = [slots[j], slots[m.b! - 1]];
        if (bad() < before) fixed = true;
        else [slots[m.b! - 1], slots[j]] = [slots[j], slots[m.b! - 1]];
      }
      if (!fixed) break;
    }
    if (bad() > 0) warnings.push('Al primo turno a eliminazione si incontrano comunque squadre qualificate dallo stesso girone (con questi numeri non si può evitare).');
    for (const m of bracket) {
      const slot = (s: number | null) => (s == null ? {} : 'team' in slots[s - 1] ? { team: (slots[s - 1] as { team: number }).team } : { src: (slots[s - 1] as { src: string }).src });
      const a = slot(m.a) as { team?: number; src?: string };
      const b = slot(m.b) as { team?: number; src?: string };
      matches.push({ stage: 'eliminazione', group: null, round: m.round, pos: m.pos, home: a.team ?? null, away: b.team ?? null, homeSrc: a.src, awaySrc: b.src, next: m.next });
    }
  };
  if (rules.format === 'eliminazione') {
    koFrom(ordered.map((team) => ({ team })));
    return { groups: [], draw, matches, warnings };
  }
  const k = rules.format === 'girone' ? 1 : rules.groups_count;
  const groups = snake(ordered, k);
  if (groups.some((g) => g.length < 2)) throw new Error('Ogni girone deve avere almeno 2 squadre: riduci i gironi.');
  groups.forEach((g, gi) => roundRobin(g, rules.double_round).forEach((m, i) => matches.push({ stage: 'girone', group: gi, round: m.round, pos: i + 1, home: m.home, away: m.away })));
  if (rules.format === 'gironi_eliminazione') {
    if (groups.some((g) => g.length < rules.qualifiers)) throw new Error('Le qualificate per girone superano le squadre del girone più piccolo.');
    if (k * rules.qualifiers < 2) throw new Error('Servono almeno 2 qualificate.');
    const slots: { src: string }[] = [];
    for (let q = 1; q <= rules.qualifiers; q++) for (let gi = 0; gi < k; gi++) slots.push({ src: `G${gi}:${q}` });
    koFrom(slots);
  }
  return { groups, draw, matches, warnings };
}

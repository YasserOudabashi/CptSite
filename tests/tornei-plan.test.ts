import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, knockout, roundRobin, snake } from '../src/tornei/plan';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

test('girone all\'italiana 3-16 squadre: ogni coppia una volta (due con il ritorno), mai due partite per turno', () => {
  for (let n = 3; n <= 16; n++) {
    for (const double of [false, true]) {
      const m = roundRobin(ids(n), double);
      const times = double ? 2 : 1;
      assert.equal(m.length, ((n * (n - 1)) / 2) * times, `n=${n}`);
      const pairs = new Map<string, number>();
      for (const x of m) pairs.set([x.home, x.away].sort().join('-'), (pairs.get([x.home, x.away].sort().join('-')) ?? 0) + 1);
      assert.equal(pairs.size, (n * (n - 1)) / 2);
      assert.ok([...pairs.values()].every((c) => c === times));
      const perRound = new Map<number, number[]>();
      for (const x of m) perRound.set(x.round, [...(perRound.get(x.round) ?? []), x.home, x.away]);
      for (const teams of perRound.values()) assert.equal(new Set(teams).size, teams.length);
      // ogni squadra gioca (n-1)*times partite
      for (const t of ids(n)) assert.equal(m.filter((x) => x.home === t || x.away === t).length, (n - 1) * times);
      // turni: n-1 (pari) o n (dispari), moltiplicati per il ritorno
      assert.equal(Math.max(...m.map((x) => x.round)), (n % 2 ? n : n - 1) * times);
    }
  }
});

test('ritorno: casa e trasferta invertite', () => {
  const m = roundRobin(ids(4), true);
  const a = m.filter((x) => x.round <= 3);
  for (const x of a) assert.ok(m.some((y) => y.round > 3 && y.home === x.away && y.away === x.home));
});

test('eliminazione diretta 2-16 squadre: n-1 partite, tutti entrano una volta, un solo finale', () => {
  for (let n = 2; n <= 16; n++) {
    const m = knockout(n);
    assert.equal(m.length, n - 1, `n=${n}`);
    const entries = m.flatMap((x) => [x.a, x.b]).filter((s): s is number => s != null).sort((a, b) => a - b);
    assert.deepEqual(entries, ids(n), `n=${n}`);
    const rounds = Math.max(...m.map((x) => x.round));
    assert.equal(m.filter((x) => x.round === rounds).length, 1);
    assert.equal(m.filter((x) => !x.next).length, 1);
    // ogni partita (tranne il finale) ha un successore esistente; ogni partita riceve esattamente 2 ingressi (squadre dirette + vincitori)
    for (const x of m) {
      if (x.next) assert.ok(m.some((y) => y.round === x.next!.round && y.pos === x.next!.pos));
      const feeders = m.filter((y) => y.next?.round === x.round && y.next.pos === x.pos).length;
      const direct = [x.a, x.b].filter((s) => s != null).length;
      assert.equal(feeders + direct, 2, `n=${n} round ${x.round} pos ${x.pos}`);
    }
  }
});

test('eliminazione con turni di riposo: 5 squadre, le teste di serie 1-3 riposano; 1 contro 4 non esiste', () => {
  const m = knockout(5);
  const r1 = m.filter((x) => x.round === 1);
  assert.equal(r1.length, 1);
  assert.deepEqual([r1[0].a, r1[0].b], [4, 5]);
  const semi = m.filter((x) => x.round === 2).map((x) => [x.a, x.b]);
  assert.deepEqual(semi, [[1, null], [2, 3]]);
});

test('8 squadre: 1-8, 4-5, 2-7, 3-6 (le prime due si incontrano solo in finale)', () => {
  const r1 = knockout(8).filter((x) => x.round === 1).map((x) => [x.a, x.b]);
  assert.deepEqual(r1, [[1, 8], [4, 5], [2, 7], [3, 6]]);
});

test('gironi a serpentina', () => {
  assert.deepEqual(snake([1, 2, 3, 4, 5, 6, 7, 8], 2), [[1, 4, 5, 8], [2, 3, 6, 7]]);
});

const T = (n: number, seeds: Record<number, number> = {}) => ids(n).map((id) => ({ id, seed_no: seeds[id] ?? null }));

test('buildPlan girone: stesso seme = stesso calendario; sorteggi diversi con semi diversi', () => {
  const rules = { format: 'girone' as const, double_round: false, groups_count: 1, qualifiers: 1 };
  const a = buildPlan(rules, T(6), 42);
  assert.equal(a.matches.length, 15);
  assert.deepEqual(buildPlan(rules, T(6), 42).matches, a.matches);
  assert.notDeepEqual(buildPlan(rules, T(6), 43).groups, a.groups);
  assert.deepEqual([...a.draw.values()].sort((x, y) => x - y), ids(6));
});

test('buildPlan eliminazione: teste di serie scelte a mano al primo posto', () => {
  const p = buildPlan({ format: 'eliminazione', double_round: false, groups_count: 1, qualifiers: 1 }, T(8, { 5: 1, 3: 2 }), 7);
  const first = p.matches.filter((m) => m.round === 1);
  assert.equal(first.length, 4);
  const m15 = first.find((m) => m.home === 5 || m.away === 5)!;
  const m23 = first.find((m) => m.home === 3 || m.away === 3)!;
  assert.notEqual(m15, m23);
  // il numero 1 e il numero 2 stanno in metà opposte: si incontrano solo in finale
  assert.ok(first.indexOf(m15) < 2 !== first.indexOf(m23) < 2);
});

test('buildPlan gironi + eliminazione: 8 squadre, 2 gironi, 2 qualificate = 12 + 3 partite, slot dai gironi', () => {
  const p = buildPlan({ format: 'gironi_eliminazione', double_round: false, groups_count: 2, qualifiers: 2 }, T(8), 1);
  assert.equal(p.groups.length, 2);
  assert.equal(p.matches.filter((m) => m.stage === 'girone').length, 12);
  const ko = p.matches.filter((m) => m.stage === 'eliminazione');
  assert.equal(ko.length, 3);
  const semi = ko.filter((m) => m.round === 1).map((m) => [m.homeSrc, m.awaySrc]);
  assert.deepEqual(semi, [['G0:1', 'G1:2'], ['G1:1', 'G0:2']]); // A1-B2 e B1-A2
});

test('buildPlan: errori chiari', () => {
  assert.throws(() => buildPlan({ format: 'girone', double_round: false, groups_count: 1, qualifiers: 1 }, T(1), 1), /almeno 2/);
  assert.throws(() => buildPlan({ format: 'gironi_eliminazione', double_round: false, groups_count: 4, qualifiers: 1 }, T(5), 1), /almeno 2 squadre/);
  assert.throws(() => buildPlan({ format: 'gironi_eliminazione', double_round: false, groups_count: 2, qualifiers: 4 }, T(6), 1), /qualificate/);
});

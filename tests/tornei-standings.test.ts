import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings, type SMatch } from '../src/tornei/standings';

const R = { pts_win: 3, pts_draw: 1, pts_loss: 0, tiebreaks: 'punti,scontro_diretto,differenza,fatti,sorteggio' };
const m = (home: number, away: number, hs: number, as: number): SMatch => ({ home, away, hs, as });
const order = (rows: { team: number }[]) => rows.map((r) => r.team);

test('classifica: punti, V/N/P, gol fatti/subiti e differenza dai risultati', () => {
  const rows = standings([1, 2, 3], [m(1, 2, 2, 0), m(1, 3, 1, 1), m(2, 3, 0, 3)], R);
  assert.deepEqual(order(rows), [3, 1, 2]);
  assert.deepEqual(rows[0], { team: 3, played: 2, won: 1, drawn: 1, lost: 0, gf: 4, ga: 1, diff: 3, points: 4 });
  assert.deepEqual(rows[1], { team: 1, played: 2, won: 1, drawn: 1, lost: 0, gf: 3, ga: 1, diff: 2, points: 4 });
  assert.deepEqual(rows[2], { team: 2, played: 2, won: 0, drawn: 0, lost: 2, gf: 0, ga: 5, diff: -5, points: 0 });
});

test('punti configurabili per vittoria, pareggio, sconfitta', () => {
  const rows = standings([1, 2], [m(1, 2, 1, 1), m(1, 2, 2, 0)], { ...R, pts_win: 2, pts_draw: 1, pts_loss: 1 });
  assert.deepEqual(rows.map((r) => r.points), [3, 2]);
});

test('spareggio: scontro diretto prima della differenza reti', () => {
  // 1 e 2 hanno 6 punti; 1 ha battuto 2, ma 2 ha una differenza reti molto migliore
  const ms = [m(1, 2, 1, 0), m(1, 3, 1, 0), m(1, 4, 0, 1), m(2, 3, 5, 0), m(2, 4, 5, 0), m(3, 4, 0, 0)];
  assert.deepEqual(order(standings([1, 2, 3, 4], ms, R)), [1, 2, 4, 3]);
  assert.deepEqual(order(standings([1, 2, 3, 4], ms, { ...R, tiebreaks: 'punti,differenza,scontro_diretto' })), [2, 1, 4, 3]);
});

test('spareggio: differenza reti, poi gol fatti, in parità totale 4 squadre a 4 punti', () => {
  const ms = [m(1, 2, 2, 0), m(1, 3, 0, 0), m(1, 4, 1, 2), m(2, 3, 1, 0), m(2, 4, 3, 3), m(3, 4, 2, 1)];
  const rows = standings([1, 2, 3, 4], ms, R);
  assert.ok(rows.every((r) => r.points === 4));
  // scontro diretto tra tutte e 4 = stessi punti: decide la differenza (1:+1, 3:0, 4:0, 2:-1), poi i gol fatti (4 > 3)
  assert.deepEqual(order(rows), [1, 4, 3, 2]);
});

test('scontro diretto solo tra le squadre ancora pari; sorteggio come ultima risorsa', () => {
  // 1, 2, 3 pari a 3 punti (ciclo 1>2>3>1 tutti 1-0): scontro diretto pari, differenza pari, gol fatti pari -> sorteggio
  const ms = [m(1, 2, 1, 0), m(2, 3, 1, 0), m(3, 1, 1, 0)];
  const draw = new Map([[1, 3], [2, 1], [3, 2]]);
  assert.deepEqual(order(standings([1, 2, 3], ms, R, draw)), [2, 3, 1]);
  assert.deepEqual(order(standings([1, 2, 3], ms, R, new Map([[1, 1], [2, 2], [3, 3]]))), [1, 2, 3]);
});

test('criteri in ordine diverso e senza partite', () => {
  assert.deepEqual(order(standings([5, 6], [], R, new Map([[5, 2], [6, 1]]))), [6, 5]);
  const ms = [m(1, 2, 5, 4), m(2, 3, 1, 0), m(3, 1, 1, 0)];
  // 1: 3 pt (+0) 2: 3 pt (-0) ... scelto per gol fatti prima
  const byGoals = standings([1, 2, 3], ms, { ...R, tiebreaks: 'punti,fatti' });
  assert.equal(byGoals[0].team, 1);
});

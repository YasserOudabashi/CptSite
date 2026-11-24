import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { torneiRouter } from '../src/tornei/router';
import { parseSets } from '../src/tornei/results';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let me = 0;
let roles: string[] = ['allievo'];
const u: Record<string, number> = {};
let tg: number; // girone, punti
let ts: number; // set
let tk: number; // eliminazione
let mg: number; // partita girone (arbitro: ref)
let mg2: number; // partita girone (nessun arbitro)

const as = (n: string, r = ['allievo']) => {
  me = u[n];
  roles = r;
};
const post = (path: string, body: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of ([] as string[]).concat(v)) p.append(k, x);
  return fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: p });
};
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;
const match = async (id: number) => (await q('SELECT * FROM tournament_matches WHERE id = $1', [id]))[0];

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  for (const n of ['org', 'ref', 'ref2', 'p1', 'p2', 'out', 'resp']) {
    u[n] = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'T') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
  }
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const mk = async (name: string, extra: string) =>
    (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, max_teams, forfeit_score ${extra.split('|')[0]}) VALUES ($1,$2,$3,'X','in corso','singoli',8,5 ${extra.split('|')[1]}) RETURNING id`, [y, u.org, name])).rows[0].id;
  tg = await mk('G', '|');
  ts = await mk('S', ', score_type|, \'set\'');
  tk = await mk('K', ', format|, \'eliminazione\'');
  const teams = async (t: number, a: string, b: string) => {
    const ids: number[] = [];
    for (const [n, who] of [[a, 'p1'], [b, 'p2']]) {
      const id = (await pool.query(`INSERT INTO tournament_teams (tournament_id, name, approved) VALUES ($1,$2,true) RETURNING id`, [t, n])).rows[0].id;
      await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [id, t, u[who]]);
      ids.push(id);
    }
    return ids;
  };
  for (const t of [tg, ts, tk]) {
    await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [t, u.org]);
    await pool.query('INSERT INTO tournament_referees VALUES ($1,$2)', [t, u.ref]);
  }
  const ins = async (t: number, stage: string, ids: number[], ref: number | null, pos = 1) =>
    (await pool.query(`INSERT INTO tournament_matches (tournament_id, stage, round, pos, home_id, away_id, referee_id) VALUES ($1,$2,1,$3,$4,$5,$6) RETURNING id`, [t, stage, pos, ids[0], ids[1], ref])).rows[0].id;
  const g = await teams(tg, 'Rossi', 'Blu');
  mg = await ins(tg, 'girone', g, u.ref);
  mg2 = await ins(tg, 'girone', g, null, 2);
  ts = Number(ts);
  global.__ms = await ins(ts, 'girone', await teams(ts, 'Alfa', 'Beta'), u.ref);
  global.__mk = await ins(tk, 'eliminazione', await teams(tk, 'Uno', 'Due'), u.ref);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: me, roles } as never;
    next();
  });
  app.use(torneiRouter(pool));
  server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await stopDb();
});

declare global {
  // eslint-disable-next-line no-var
  var __ms: number, __mk: number;
}

test('parseSets: al meglio di 3 e di 5, pareggi e set oltre la fine', () => {
  assert.deepEqual(parseSets(['25-20', '20-25', '15-10'], 3, true), { h: 2, a: 1, text: '25-20,20-25,15-10' });
  assert.deepEqual(parseSets(['25-20', '25-10'], 3, true), { h: 2, a: 0, text: '25-20,25-10' });
  assert.throws(() => parseSets(['25-20'], 3, true), /finisce/);
  assert.deepEqual(parseSets(['25-20'], 3, false).h, 1);
  assert.throws(() => parseSets(['25-20', '25-10', '5-25'], 3, true), /dopo la fine/);
  assert.throws(() => parseSets(['25-25'], 3, false), /parità/);
  assert.throws(() => parseSets(['abc'], 3, false), /25-20/);
  assert.throws(() => parseSets(['1-0', '1-0', '1-0', '1-0'], 3, false), /Al massimo 3/);
  assert.equal(parseSets(['25-20', '20-25', '15-10', '10-15', '15-12'], 5, true).h, 3);
});

test('US-036: solo arbitro della partita e organizzatori; capitani, giocatori e responsabili no', async () => {
  const body = { status: 'finita', home_score: '2', away_score: '1' };
  for (const [who, r] of [['p1', ['allievo']], ['p2', ['allievo']], ['out', ['allievo']], ['ref2', ['allievo']], ['resp', ['resp_tornei']], ['resp', ['resp_sito']]] as [string, string[]][]) {
    as(who, r);
    await post(`/tornei/${tg}/partite/${mg}/risultato`, body);
    assert.equal((await match(mg)).status, 'da giocare', `${who} ${r}`);
    assert.equal((await fetch(`${base}/tornei/${tg}/partite/${mg}`)).status, 403);
  }
  // l'arbitro assegnato a un'altra partita non può su questa
  as('ref');
  await post(`/tornei/${tg}/partite/${mg2}/risultato`, body);
  assert.equal((await match(mg2)).status, 'da giocare');
  // l'arbitro della partita sì
  await post(`/tornei/${tg}/partite/${mg}/risultato`, body);
  const m = await match(mg);
  assert.deepEqual([m.status, m.home_score, m.away_score], ['finita', 2, 1]);
  assert.equal(m.winner_id, m.home_id);
  // l'organizzatore sì, anche dove non è arbitro
  as('org');
  await post(`/tornei/${tg}/partite/${mg2}/risultato`, { status: 'in corso', home_score: '1', away_score: '1' });
  assert.equal((await match(mg2)).status, 'in corso');
});

test('US-036: ogni correzione è registrata (chi, quando, valore precedente)', async () => {
  as('org');
  await post(`/tornei/${tg}/partite/${mg}/risultato`, { status: 'finita', home_score: '2', away_score: '3', note: 'corretto' });
  const log = await q('SELECT user_id, at, previous FROM tournament_result_log WHERE match_id = $1 ORDER BY id', [mg]);
  assert.equal(log.length, 2);
  assert.equal(log[0].user_id, u.ref);
  assert.equal(JSON.parse(log[1].previous).home_score, 2);
  assert.equal(log[1].user_id, u.org);
  assert.equal((await match(mg)).winner_id, (await match(mg)).away_id);
  assert.match(await (await fetch(`${base}/tornei/${tg}/partite/${mg}`)).text(), /prima:/);
});

test('US-036: forfait col punteggio configurato (5-0), annullata, valori non validi', async () => {
  as('org');
  await post(`/tornei/${tg}/partite/${mg2}/risultato`, { status: 'finita', forfeit: 'away' });
  const m = await match(mg2);
  assert.deepEqual([m.status, m.home_score, m.away_score, m.forfeit, m.winner_id], ['finita', 0, 5, true, m.away_id]);
  await post(`/tornei/${tg}/partite/${mg2}/risultato`, { status: 'annullata' });
  const a = await match(mg2);
  assert.deepEqual([a.status, a.home_score, a.winner_id, a.forfeit], ['annullata', null, null, false]);
  await post(`/tornei/${tg}/partite/${mg2}/risultato`, { status: 'finita', home_score: '-1', away_score: 'x' });
  assert.equal((await match(mg2)).status, 'annullata');
  // nel girone il pareggio è consentito
  await post(`/tornei/${tg}/partite/${mg2}/risultato`, { status: 'finita', home_score: '2', away_score: '2' });
  assert.deepEqual([(await match(mg2)).status, (await match(mg2)).winner_id], ['finita', null]);
});

test('US-036: punteggio per set', async () => {
  as('ref');
  const id = global.__ms;
  await post(`/tornei/${ts}/partite/${id}/risultato`, { status: 'finita', sets: ['25-20', '', ''] });
  assert.equal((await match(id)).status, 'da giocare');
  await post(`/tornei/${ts}/partite/${id}/risultato`, { status: 'finita', sets: ['25-20', '20-25', '15-10'] });
  const m = await match(id);
  assert.deepEqual([m.status, m.home_score, m.away_score, m.sets], ['finita', 2, 1, '25-20,20-25,15-10']);
  assert.equal(m.winner_id, m.home_id);
});

test('US-036: eliminazione, il pareggio non è ammesso: serve il vincitore con nota', async () => {
  as('ref');
  const id = global.__mk;
  await post(`/tornei/${tk}/partite/${id}/risultato`, { status: 'finita', home_score: '1', away_score: '1' });
  assert.equal((await match(id)).status, 'da giocare');
  await post(`/tornei/${tk}/partite/${id}/risultato`, { status: 'finita', home_score: '1', away_score: '1', winner: 'away' });
  assert.equal((await match(id)).status, 'da giocare'); // manca la nota
  await post(`/tornei/${tk}/partite/${id}/risultato`, { status: 'finita', home_score: '1', away_score: '1', winner: 'away', note: 'rigori 3-4' });
  const m = await match(id);
  assert.deepEqual([m.status, m.winner_id === m.away_id, m.note], ['finita', true, 'rigori 3-4']);
});

test('US-036: eventi per giocatore (gol, cartellini), solo giocatori della partita', async () => {
  as('ref');
  await post(`/tornei/${tg}/partite/${mg}/eventi`, { user: String(u.p1), kind: 'gol' });
  await post(`/tornei/${tg}/partite/${mg}/eventi`, { user: String(u.out), kind: 'gol' });
  await post(`/tornei/${tg}/partite/${mg}/eventi`, { user: String(u.p2), kind: 'giallo' });
  const ev = await q('SELECT user_id, kind FROM tournament_match_events WHERE match_id = $1 ORDER BY id', [mg]);
  assert.deepEqual(ev.map((e) => [e.user_id, e.kind]), [[u.p1, 'gol'], [u.p2, 'giallo']]);
  as('p1');
  await post(`/tornei/${tg}/partite/${mg}/eventi`, { user: String(u.p1), kind: 'gol' });
  assert.equal((await q('SELECT 1 FROM tournament_match_events')).length, 2);
});

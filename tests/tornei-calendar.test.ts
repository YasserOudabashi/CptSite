import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { torneiRouter } from '../src/tornei/router';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let org = 0;
let t: number;

const post = (path: string, body: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

async function newTournament(format: string, n: number, groups = 2): Promise<number> {
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const id = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, format, max_teams, groups_count) VALUES ($1,$2,'T','Calcio','iscrizioni','singoli',$3,32,$4) RETURNING id`, [y, org, format, groups])).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [id, org]);
  for (let i = 0; i < n; i++) {
    await pool.query(`INSERT INTO tournament_teams (tournament_id, name, approved) VALUES ($1,$2,true)`, [id, `S${i + 1}`]);
  }
  return id;
}

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  org = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('o@x.ch','O','O') RETURNING id`)).rows[0].id;
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: org, roles: ['allievo'] } as never;
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

test('US-034: anteprima senza salvare; la conferma crea le partite e porta il torneo in corso', async () => {
  t = await newTournament('girone', 5);
  const html = await (await fetch(`${base}/tornei/${t}/calendario?seed=5`)).text();
  assert.match(html, /Conferma e avvia/);
  assert.equal((await q('SELECT 1 FROM tournament_matches')).length, 0);
  await post(`/tornei/${t}/calendario`, { seed: '5' });
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1', [t])).length, 10);
  assert.equal((await q('SELECT status FROM tournaments WHERE id = $1', [t]))[0].status, 'in corso');
  assert.equal((await q('SELECT count(DISTINCT draw_no)::int AS n FROM tournament_teams WHERE tournament_id = $1', [t]))[0].n, 5);
  // impostazioni bloccate dopo la generazione
  await post(`/tornei/${t}/gestione`, { name: 'T', sport: 'Calcio', max_teams: '3' });
  assert.equal((await q('SELECT max_teams FROM tournaments WHERE id = $1', [t]))[0].max_teams, 32);
});

test('US-034: rigenerabile finche non ci sono risultati, con lo stesso seme stesse partite', async () => {
  const rows = () => q('SELECT round, home_id, away_id FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, pos, id', [t]);
  const first = JSON.stringify(await rows());
  await post(`/tornei/${t}/calendario`, { seed: '5' });
  assert.equal(JSON.stringify(await rows()), first);
  await post(`/tornei/${t}/calendario`, { seed: '99' });
  assert.equal((await rows()).length, 10);
  await pool.query(`UPDATE tournament_matches SET status = 'finita', home_score = 1, away_score = 0 WHERE id = (SELECT min(id) FROM tournament_matches WHERE tournament_id = $1)`, [t]);
  await post(`/tornei/${t}/calendario`, { seed: '7' });
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1 AND status = $2', [t, 'finita'])).length, 1);
});

test('US-034: eliminazione con riposi, gironi + eliminazione, ogni squadra il numero giusto di partite', async () => {
  const e = await newTournament('eliminazione', 6);
  await post(`/tornei/${e}/calendario`, { seed: '3' });
  const m = await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, pos', [e]);
  assert.equal(m.length, 5);
  const final = m.find((x: { round: number }) => x.round === 3)!;
  assert.equal(final.home_id, null);
  assert.equal(m.filter((x: { next_match_id: number | null }) => x.next_match_id).length, 4);
  const g = await newTournament('gironi_eliminazione', 8, 2);
  await post(`/tornei/${g}/calendario`, { seed: '3' });
  const gm = await q('SELECT stage, home_src FROM tournament_matches WHERE tournament_id = $1', [g]);
  assert.equal(gm.filter((x: { stage: string }) => x.stage === 'girone').length, 12);
  assert.equal(gm.filter((x: { stage: string }) => x.stage === 'eliminazione').length, 3);
  assert.equal((await q('SELECT 1 FROM tournament_groups WHERE tournament_id = $1', [g])).length, 2);
  assert.ok(gm.some((x: { home_src: string | null }) => /^G\d+:1$/.test(x.home_src ?? '')));
  for (const team of await q('SELECT id FROM tournament_teams WHERE tournament_id = $1', [g])) {
    assert.equal((await q(`SELECT 1 FROM tournament_matches WHERE stage = 'girone' AND (home_id = $1 OR away_id = $1)`, [team.id])).length, 3);
  }
});

test('US-034: squadre insufficienti o non valide, bozza, teste di serie', async () => {
  const one = await newTournament('girone', 1);
  await post(`/tornei/${one}/calendario`, { seed: '1' });
  assert.equal((await q('SELECT status FROM tournaments WHERE id = $1', [one]))[0].status, 'iscrizioni');
  const inc = await newTournament('girone', 3);
  await pool.query(`UPDATE tournament_teams SET approved = false WHERE id = (SELECT min(id) FROM tournament_teams WHERE tournament_id = $1)`, [inc]);
  await pool.query(`UPDATE tournaments SET team_min = 2, team_max = 2, mode = 'squadre' WHERE id = $1`, [inc]);
  await post(`/tornei/${inc}/calendario`, { seed: '1' }); // 2 squadre accettate: l'altra e' esclusa
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1', [inc])).length, 1);
  const draft = await newTournament('girone', 3);
  await pool.query(`UPDATE tournaments SET status = 'bozza' WHERE id = $1`, [draft]);
  await post(`/tornei/${draft}/calendario`, { seed: '1' });
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1', [draft])).length, 0);
  const s = await newTournament('eliminazione', 4);
  const last = (await q('SELECT id FROM tournament_teams WHERE tournament_id = $1 ORDER BY id DESC LIMIT 1', [s]))[0].id;
  await post(`/tornei/${s}/serie`, { [`s${last}`]: '1' });
  assert.equal((await q('SELECT seed_no FROM tournament_teams WHERE id = $1', [last]))[0].seed_no, 1);
  await post(`/tornei/${s}/calendario`, { seed: '4' });
  const r1 = await q('SELECT home_id, away_id FROM tournament_matches WHERE tournament_id = $1 AND round = 1 ORDER BY pos', [s]);
  assert.equal(r1[0].home_id, last);
});

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
let me = 0;
let roles: string[] = [];
let ids: Record<string, number> = {};
let actId: number;

const post = (path: string, body: Record<string, string>) =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const form = (o: Record<string, string> = {}) => ({ name: 'Torneo', sport: 'Calcio', mode: 'squadre', team_min: '5', team_max: '8', format: 'girone', groups_count: '2', qualifiers: '2', score_type: 'punti', best_of: '3', pts_win: '3', pts_draw: '1', pts_loss: '0', forfeit_score: '3', match_minutes: '30', max_teams: '8', tiebreaks: 'punti,differenza', ...o });
const as = (who: string, r: string[] = ['allievo']) => {
  me = ids[who];
  roles = r;
};

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  for (const n of ['org', 'resp', 'altro', 'arb']) {
    ids[n] = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'Test') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
  }
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  actId = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'Calcetto',$2,'approvata',5) RETURNING id`, [y, ids.org])).rows[0].id;
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

test('US-032: un allievo senza attività non crea tornei; l\'organizzatore GA solo per la sua attività', async () => {
  as('altro');
  assert.equal((await fetch(`${base}/tornei/nuovo`)).status, 403);
  assert.equal((await post('/tornei/nuovo', form({ activity_id: String(actId) }))).headers.get('location'), '/tornei/nuovo');
  assert.equal((await pool.query('SELECT 1 FROM tournaments')).rowCount, 0);
  as('org');
  assert.equal((await fetch(`${base}/tornei/nuovo`)).status, 200);
  // senza attività: rifiutato
  await post('/tornei/nuovo', form());
  assert.equal((await pool.query('SELECT 1 FROM tournaments')).rowCount, 0);
  const r = await post('/tornei/nuovo', form({ activity_id: String(actId) }));
  assert.match(r.headers.get('location')!, /^\/tornei\/\d+\/gestione$/);
  const t = (await pool.query('SELECT * FROM tournaments')).rows[0];
  assert.equal(t.activity_id, actId);
  assert.equal(t.status, 'bozza');
  assert.equal((await pool.query('SELECT 1 FROM tournament_organizers WHERE tournament_id = $1 AND user_id = $2', [t.id, ids.org])).rowCount, 1);
  ids.t1 = t.id;
});

test('US-032: la bozza non è visibile agli altri; il Responsabile tornei vede e gestisce tutto', async () => {
  as('altro');
  assert.equal((await fetch(`${base}/tornei/${ids.t1}`)).status, 404);
  assert.doesNotMatch(await (await fetch(`${base}/tornei`)).text(), /Torneo/);
  assert.equal((await fetch(`${base}/tornei/${ids.t1}/gestione`)).status, 403);
  as('resp', ['resp_tornei']);
  assert.equal((await fetch(`${base}/tornei/${ids.t1}/gestione`)).status, 200);
  assert.match(await (await fetch(`${base}/tornei`)).text(), /Torneo/);
  // torneo libero (senza attività) solo per il Responsabile tornei
  const r = await post('/tornei/nuovo', form({ name: 'Libero', sport: 'Ping-pong', mode: 'singoli' }));
  assert.match(r.headers.get('location')!, /gestione$/);
  const l = (await pool.query(`SELECT * FROM tournaments WHERE name = 'Libero'`)).rows[0];
  assert.equal(l.activity_id, null);
  assert.equal(l.team_max, 1);
});

test('US-032: organizzatori e arbitri per nome o ID, campi, stati', async () => {
  as('org');
  await post(`/tornei/${ids.t1}/persone/referees`, { q: 'arb@x.ch' });
  await post(`/tornei/${ids.t1}/persone/organizers`, { q: 'resp@x.ch' });
  await post(`/tornei/${ids.t1}/persone/referees`, { q: 'zzz' });
  assert.deepEqual((await pool.query('SELECT user_id FROM tournament_referees')).rows.map((r) => r.user_id), [ids.arb]);
  assert.equal((await pool.query('SELECT 1 FROM tournament_organizers WHERE tournament_id = $1', [ids.t1])).rowCount, 2);
  await post(`/tornei/${ids.t1}/campi`, { name: 'Palestra A' });
  assert.equal((await pool.query('SELECT 1 FROM tournament_fields')).rowCount, 1);
  // l'ultimo organizzatore non si toglie
  await post(`/tornei/${ids.t1}/persone/organizers/togli`, { user: String(ids.resp) });
  await post(`/tornei/${ids.t1}/persone/organizers/togli`, { user: String(ids.org) });
  assert.equal((await pool.query('SELECT 1 FROM tournament_organizers WHERE tournament_id = $1', [ids.t1])).rowCount, 1);
  await post(`/tornei/${ids.t1}/stato`, { to: 'concluso' });
  assert.equal((await pool.query('SELECT status FROM tournaments WHERE id = $1', [ids.t1])).rows[0].status, 'bozza');
  await post(`/tornei/${ids.t1}/stato`, { to: 'iscrizioni' });
  assert.equal((await pool.query('SELECT status FROM tournaments WHERE id = $1', [ids.t1])).rows[0].status, 'iscrizioni');
  as('altro');
  assert.match(await (await fetch(`${base}/tornei`)).text(), /Torneo/);
});

test('US-032: impostazioni cambiabili finché non c\'è il calendario, poi solo nome/descrizione/regolamento', async () => {
  as('org');
  await post(`/tornei/${ids.t1}/gestione`, form({ name: 'Nuovo nome', max_teams: '12', rules: 'Regole' }));
  let t = (await pool.query('SELECT * FROM tournaments WHERE id = $1', [ids.t1])).rows[0];
  assert.equal(t.max_teams, 12);
  assert.equal(t.name, 'Nuovo nome');
  await post(`/tornei/${ids.t1}/gestione`, form({ max_teams: 'abc' }));
  assert.equal((await pool.query('SELECT max_teams FROM tournaments WHERE id = $1', [ids.t1])).rows[0].max_teams, 12);
  await pool.query(`INSERT INTO tournament_matches (tournament_id, stage, round, pos) VALUES ($1,'girone',1,1)`, [ids.t1]);
  await post(`/tornei/${ids.t1}/gestione`, form({ name: 'Ancora', max_teams: '4', format: 'eliminazione', rules: 'Nuove' }));
  t = (await pool.query('SELECT * FROM tournaments WHERE id = $1', [ids.t1])).rows[0];
  assert.equal(t.name, 'Ancora');
  assert.equal(t.rules, 'Nuove');
  assert.equal(t.max_teams, 12);
  assert.equal(t.format, 'girone');
  // un altro organizzatore (non di questo torneo) non può
  as('altro');
  await post(`/tornei/${ids.t1}/gestione`, form({ name: 'Hack' }));
  assert.equal((await pool.query('SELECT name FROM tournaments WHERE id = $1', [ids.t1])).rows[0].name, 'Ancora');
});

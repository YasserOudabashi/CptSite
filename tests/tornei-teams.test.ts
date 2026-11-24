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
let roles: string[] = ['allievo'];
const u: Record<string, number> = {};
let t: number;
let s: number; // torneo a singoli

const post = async (path: string, body: Record<string, string> = {}) => {
  await fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
};
const as = (n: string, r = ['allievo']) => {
  me = u[n];
  roles = r;
};
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  for (const n of ['cap', 'ami', 'ami2', 'ami3', 'solo', 'org', 'cap2']) {
    u[n] = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'Test') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
  }
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  t = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, team_min, team_max, max_teams) VALUES ($1,$2,'Calcio','Calcio','iscrizioni',2,3,2) RETURNING id`, [y, u.org])).rows[0].id;
  s = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, mode, status, max_teams) VALUES ($1,$2,'Ping','Ping-pong','singoli','iscrizioni',2) RETURNING id`, [y, u.org])).rows[0].id;
  for (const id of [t, s]) await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [id, u.org]);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: me, roles } as never;
    next();
  });
  app.use(torneiRouter(pool));
  server = await new Promise((r) => {
    const sv = app.listen(0, () => r(sv));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await stopDb();
});

test('US-033: il capitano crea la squadra, il compagno conferma, validità min/max', async () => {
  as('cap');
  await post(`/tornei/${t}/squadre`, { name: 'Leoni' });
  const team = (await q('SELECT id, captain_id FROM tournament_teams'))[0];
  assert.equal(team.captain_id, u.cap);
  await post(`/tornei/${t}/squadre/${team.id}/membri`, { q: 'ami@x.ch' });
  let page = await (await fetch(`${base}/tornei/${t}`)).text();
  assert.match(page, /incompleta/); // 1 confermato su minimo 2
  as('ami');
  assert.match(await (await fetch(`${base}/tornei/${t}`)).text(), /Conferma di giocare/);
  await post(`/tornei/${t}/squadre/${team.id}/conferma`);
  as('cap');
  page = await (await fetch(`${base}/tornei/${t}`)).text();
  assert.doesNotMatch(page, /incompleta/);
  // massimo 3 giocatori
  await post(`/tornei/${t}/squadre/${team.id}/membri`, { q: 'ami2@x.ch' });
  await post(`/tornei/${t}/squadre/${team.id}/membri`, { q: 'ami3@x.ch' });
  assert.equal((await q('SELECT 1 FROM tournament_members')).length, 3);
  // un compagno non capitano non aggiunge
  as('ami');
  await post(`/tornei/${t}/squadre/${team.id}/membri`, { q: 'solo@x.ch' });
  assert.equal((await q('SELECT 1 FROM tournament_members')).length, 3);
});

test('US-033: una sola squadra per torneo, nome unico, massimo squadre senza eccezioni', async () => {
  as('cap');
  await post(`/tornei/${t}/squadre`, { name: 'Altra' }); // già in una squadra
  assert.equal((await q('SELECT 1 FROM tournament_teams')).length, 1);
  as('cap2');
  await post(`/tornei/${t}/squadre`, { name: 'leoni' }); // nome già usato
  assert.equal((await q('SELECT 1 FROM tournament_teams')).length, 1);
  await post(`/tornei/${t}/squadre`, { name: 'Tigri' });
  assert.equal((await q('SELECT 1 FROM tournament_teams')).length, 2);
  // torneo pieno (max 2): rifiutato anche all'organizzatore
  as('solo');
  await post(`/tornei/${t}/squadre`, { name: 'Terza' });
  as('org');
  await post(`/tornei/${t}/squadre/manuale`, { name: 'Quarta', q: 'solo@x.ch' });
  assert.equal((await q('SELECT 1 FROM tournament_teams')).length, 2);
  assert.match(await (await fetch(`${base}/tornei/${t}`)).text(), /0 posti rimasti/);
  // in un altro torneo sì
  as('cap');
  await post(`/tornei/${s}/squadre`, {});
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [s])).length, 1);
});

test('US-033: singoli, ritiro, iscrizioni chiuse, accettazione a mano', async () => {
  as('ami2'); // era invitato nella squadra Leoni (non confermato): ora si iscrive ai singoli? no, torneo pieno dopo 2
  await post(`/tornei/${s}/squadre`, {});
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [s])).length, 2);
  as('solo');
  await post(`/tornei/${s}/squadre`, {}); // pieno
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [s])).length, 2);
  as('cap');
  const mine = (await q('SELECT id FROM tournament_teams WHERE tournament_id = $1 AND captain_id = $2', [s, u.cap]))[0].id;
  await post(`/tornei/${s}/squadre/${mine}/ritira`);
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [s])).length, 1);
  // un altro non ritira la squadra di altri
  as('solo');
  const other = (await q('SELECT id FROM tournament_teams WHERE tournament_id = $1', [s]))[0].id;
  await post(`/tornei/${s}/squadre/${other}/ritira`);
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [s])).length, 1);
  // iscrizioni chiuse
  await pool.query(`UPDATE tournaments SET status = 'in corso' WHERE id = $1`, [s]);
  await post(`/tornei/${s}/squadre`, {});
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [s])).length, 1);
  // l'organizzatore accetta a mano una squadra incompleta (torneo t)
  as('org');
  const tigri = (await q(`SELECT id FROM tournament_teams WHERE name = 'Tigri'`))[0].id;
  await post(`/tornei/${t}/squadre/${tigri}/approva`, { to: '1' });
  assert.equal((await q('SELECT approved FROM tournament_teams WHERE id = $1', [tigri]))[0].approved, true);
  // l'organizzatore toglie una squadra
  await post(`/tornei/${t}/squadre/${tigri}/ritira`);
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [t])).length, 1);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let who = { id: 0, roles: ['allievo'] as string[] };
let org: number;
let other: number;
let act: number;
let sess: number;
let enr: number[] = [];

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position LIMIT 1`)).rows[0].id;
  const mk = async (l: string) => (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$1,'T') RETURNING id`, [l])).rows[0].id as number;
  org = await mk('org');
  other = await mk('other');
  act = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'Judo',$2,'approvata',9) RETURNING id`, [year, org])).rows[0].id;
  sess = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [act, day, b])).rows[0].id;
  for (const l of ['e1', 'e2', 'e3']) {
    enr.push((await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2) RETURNING id', [await mk(l), sess])).rows[0].id);
  }
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = who as never;
    next();
  });
  app.use(gaRouter(pool));
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

const save = (ids: number[]) =>
  fetch(`${base}/attivita/${act}/presenze`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['session', String(sess)], ...ids.map((i) => ['present', String(i)])]),
  });
const present = async () => (await pool.query('SELECT present FROM enrollments WHERE session_id = $1 ORDER BY id', [sess])).rows.map((r) => r.present);

test('l\'organizzatore (anche allievo) segna presente/assente solo della sua attività', async () => {
  who = { id: org, roles: ['allievo'] };
  assert.match(await (await fetch(`${base}/attivita/${act}`)).text(), /type="checkbox"/);
  assert.equal((await save([enr[0], enr[2]])).status, 200);
  assert.deepEqual(await present(), [true, false, true]);
  assert.equal((await save([enr[1]])).status, 200); // modificabile
  assert.deepEqual(await present(), [false, true, false]);
});

test('un altro utente non vede la lista né può segnare', async () => {
  who = { id: other, roles: ['allievo'] };
  const html = await (await fetch(`${base}/attivita/${act}`)).text();
  assert.doesNotMatch(html, /checkbox|e1/);
  assert.equal((await save([enr[0]])).status, 403);
  assert.deepEqual(await present(), [false, true, false]);
});

test('il Responsabile GA le segna tutte', async () => {
  who = { id: other, roles: ['resp_ga'] };
  assert.equal((await save([enr[0], enr[1], enr[2]])).status, 200);
  assert.deepEqual(await present(), [true, true, true]);
});

test('anno non più corrente: sola lettura anche per il Responsabile GA', async () => {
  await pool.query(`INSERT INTO school_years (name) VALUES ('2027-2028')`);
  await pool.query('UPDATE school_years SET is_current = false');
  await pool.query("UPDATE school_years SET is_current = true WHERE name = '2027-2028'");
  assert.equal((await save([])).status, 403);
  assert.match(await (await fetch(`${base}/attivita/${act}`)).text(), /sola lettura/);
  who = { id: org, roles: ['allievo'] };
  assert.equal((await fetch(`${base}/attivita/${act}`)).status, 404); // utenti normali: anno vecchio non visibile
  await pool.query('UPDATE school_years SET is_current = false');
  await pool.query("UPDATE school_years SET is_current = true WHERE name = '2026-2027'");
});

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
let me: number;
let other: number;
let current: number;
let mine: number;
let theirs: number;
let rejected: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const mkUser = async (login: string, first: string, cls: string | null) =>
    (await pool.query(`INSERT INTO users (login_id, first_name, last_name, class_name) VALUES ($1,$2,'Bianchi',$3) RETURNING id`, [login, first, cls])).rows[0].id;
  me = await mkUser('me@x.ch', 'Mia', null);
  other = await mkUser('o@x.ch', 'Otto', null);
  current = me;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  const blocks = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const mk = async (org: number, title: string, status: string, reason: string | null) =>
    (await pool.query(
      `INSERT INTO activities (school_year_id, title, description, organizer_id, status, reject_reason, max_participants) VALUES ($1,$2,'D',$3,$4,$5,5) RETURNING id`,
      [year, title, org, status, reason])).rows[0].id;
  mine = await mk(me, 'Mia attività', 'approvata', null);
  theirs = await mk(other, 'Altrui', 'approvata', null);
  rejected = await mk(me, 'Bocciata', 'rifiutata', 'Troppo rumorosa');
  const s = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [mine, day, blocks[0]])).rows[0].id;
  for (const [i, c] of [['Zeno', '3A'], ['Ada', '2B'], ['Eva', null]] as const) {
    const u = await mkUser(`${i}@x.ch`, i, c);
    await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [u, s]);
  }
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: current, roles: ['allievo'] } as never;
    next();
  });
  app.use(gaRouter(pool));
  server = await new Promise((r) => {
    const s2 = app.listen(0, () => r(s2));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await stopDb();
});

const post = (id: number, description: string, max: string) =>
  fetch(`${base}/la-mia-attivita/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ description, max }),
  });

test('mostra solo le proprie attività, con stato, motivo e iscritti con classe', async () => {
  const html = await (await fetch(`${base}/la-mia-attivita`)).text();
  assert.match(html, /Mia attività/);
  assert.match(html, /Troppo rumorosa/);
  assert.match(html, /Bianchi Ada \(2B\)/);
  assert.match(html, /3 iscritti/);
  assert.doesNotMatch(html, /Altrui/);
});

test('chi non ha proposto nulla non ha la pagina', async () => {
  current = 9999;
  assert.equal((await fetch(`${base}/la-mia-attivita`)).status, 404);
  current = me;
});

test('modifica: descrizione e massimo, non sotto gli iscritti, non le attività altrui', async () => {
  assert.match(await (await post(mine, 'Nuova', '8')).text(), /Salvato/);
  assert.deepEqual((await pool.query('SELECT description, max_participants FROM activities WHERE id = $1', [mine])).rows[0], { description: 'Nuova', max_participants: 8 });
  const low = await post(mine, 'X', '2');
  assert.equal(low.status, 400);
  assert.match(await low.text(), /iscritti attuali/);
  assert.equal((await post(mine, 'X', '3')).status, 200); // uguale agli iscritti: ok
  const foreign = await post(theirs, 'Hack', '9');
  assert.equal(foreign.status, 400);
  assert.equal((await pool.query('SELECT description FROM activities WHERE id = $1', [theirs])).rows[0].description, 'D');
  assert.ok(rejected);
});

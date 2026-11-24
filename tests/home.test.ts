import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { homeRouter } from '../src/ui/home';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let user: { id: number; roles: string[] } | undefined;
let sid: number;
let uid: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('a@x.ch','A','B') RETURNING id`)).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows[0].id;
  const day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1,'2027-04-21') RETURNING id`, [year])).rows[0].id;
  const a = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'X',$2,'approvata',5) RETURNING id`, [year, uid])).rows[0].id;
  sid = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [a, day, b])).rows[0].id;
  const app = express();
  app.use((req, _res, next) => {
    req.user = user as never;
    next();
  });
  app.use(homeRouter(pool));
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

test('Home: date, stato, attività scelte con link, spiegazione, niente sondaggi', async () => {
  user = { id: uid, roles: ['allievo'] };
  let html = await (await fetch(`${base}/`)).text();
  assert.match(html, /21\.04\.2027/);
  assert.match(html, /Chiuse|chiuse/);
  assert.match(html, /Attività scelte: <strong>0<\/strong> — <a href="\/programma">/);
  assert.match(html, /href="\/attivita"/);
  assert.match(html, /precedenza/);
  assert.match(html, /a caso/);
  assert.doesNotMatch(html, /sondagg|bacheca/i);
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [uid, sid]);
  html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Attività scelte: <strong>1<\/strong>/);
});

test('Home: senza date "da definire"; ospite senza programma', async () => {
  await pool.query('DELETE FROM enrollments');
  await pool.query('DELETE FROM activity_sessions');
  await pool.query('DELETE FROM ga_days');
  user = undefined;
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /da definire/);
  assert.doesNotMatch(html, /Attività scelte/);
});

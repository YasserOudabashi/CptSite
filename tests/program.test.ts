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

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1, '2027-04-21') RETURNING id`, [year])).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const room = (await pool.query(`INSERT INTO rooms (name) VALUES ('Aula 7') RETURNING id`)).rows[0].id;
  const org = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('o@x.ch','Olga','Org') RETURNING id`)).rows[0].id;
  me = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('m@x.ch','Mia','M') RETURNING id`)).rows[0].id;
  const mk = async (title: string, start: number, count: number) => {
    const a = (await pool.query(
      `INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants, room_id) VALUES ($1,$2,$3,'approvata',5,$4) RETURNING id`,
      [year, title, org, room])).rows[0].id;
    return (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id, block_count) VALUES ($1,$2,$3,$4) RETURNING id`, [a, day, b[start], count])).rows[0].id;
  };
  const lungo = await mk('Laboratorio lungo', 0, 2); // blocchi 1-2
  const assegnato = await mk('Yoga', 2, 1);
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [me, lungo]);
  await pool.query('INSERT INTO enrollments (user_id, session_id, assigned) VALUES ($1,$2,true)', [me, assegnato]);
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: me, roles: ['allievo'] } as never;
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

test('un riquadro per blocco: attività, aula, organizzatore, assegnate e blocchi liberi', async () => {
  const html = await (await fetch(`${base}/programma`)).text();
  assert.match(html, /21\.04\.2027/);
  assert.equal(html.split('Laboratorio lungo').length - 1, 2); // sessione di 2 blocchi = 2 riquadri
  assert.match(html, /Aula 7/);
  assert.match(html, /Olga Org/);
  assert.match(html, /Yoga<\/strong> <em>\(assegnata a caso\)/);
  assert.equal(html.split("Scegli un'attività").length - 1, 1); // blocco 4
  assert.match(html, /\/attivita\?block=/);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';

let pool: Pool;
let stopDb: () => Promise<void>;
let roles: string[] = ['allievo'];
let server: import('node:http').Server;
let base: string;

async function user(login: string, first: string, role: string): Promise<number> {
  const id = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1, $2, 'Rossi') RETURNING id`, [login, first])).rows[0].id;
  await pool.query('INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)', [id, role]);
  return id;
}

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const room = (await pool.query(`INSERT INTO rooms (name) VALUES ('Aula 101') RETURNING id`)).rows[0].id;
  const a = await user('a@x.ch', 'Anna', 'allievo');
  const d = await user('d@x.ch', 'Dario', 'docente');
  const mk = async (title: string, desc: string, org: number, status: string, max: number, blockId: number, roomId: number | null) => {
    const act = (await pool.query(
      `INSERT INTO activities (school_year_id, title, description, organizer_id, status, max_participants, room_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [year, title, desc, org, status, max, roomId])).rows[0].id;
    return (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [act, day, blockId])).rows[0].id;
  };
  const s1 = await mk('Scacchi', 'Torneo di scacchi', a, 'approvata', 2, b[0], room);
  await mk('Yoga', 'Rilassamento', d, 'approvata', 5, b[1], null);
  await mk('Segreta', 'Non approvata', a, 'proposta', 5, b[0], null);
  for (const [i, l] of ['e1', 'e2'].entries()) {
    const u = await user(`${l}@x.ch`, `E${i}`, 'allievo');
    await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [u, s1]);
  }
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 1, roles } as never;
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

const get = async (q = '') => (await fetch(`${base}/attivita${q}`)).text();

test('mostra solo le approvate, con posti esauriti', async () => {
  const html = await get();
  assert.match(html, /Scacchi/);
  assert.match(html, /Posti esauriti/);
  assert.match(html, /Yoga/);
  assert.match(html, /5 posti liberi su 5/);
  assert.doesNotMatch(html, /Segreta/);
  assert.match(html, /Aula 101/);
});

test('filtri: tipo organizzatore, aula, blocco, testo', async () => {
  assert.doesNotMatch(await get('?kind=docente'), /Scacchi/);
  assert.match(await get('?kind=docente'), /Yoga/);
  const room = (await pool.query(`SELECT id FROM rooms`)).rows[0].id;
  assert.doesNotMatch(await get(`?room=${room}`), /Yoga/);
  const b2 = (await pool.query(`SELECT id FROM time_blocks WHERE name = 'Blocco 2'`)).rows[0].id;
  assert.match(await get(`?block=${b2}`), /Yoga/);
  assert.doesNotMatch(await get(`?block=${b2}`), /Scacchi/);
  assert.match(await get('?q=dario'), /Yoga/);
  assert.doesNotMatch(await get('?q=dario'), /Scacchi/);
  assert.match(await get('?q=100%25'), /Nessuna attività/);
});

test('serve il permesso ga.view', async () => {
  roles = ['allievo'];
  assert.equal((await fetch(`${base}/attivita`)).status, 200);
  roles = [];
  assert.equal((await fetch(`${base}/attivita`)).status, 403);
  roles = ['allievo'];
});

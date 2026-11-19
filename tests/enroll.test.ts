import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';
import { cancelEnrollment, enroll } from '../src/ga/enroll';
import { blockLoad } from '../src/ga/approval';
import { listSessions } from '../src/ga/activities';
import { roomsWithUsage } from '../src/ga/proposals';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let year: number;
let day: number;
let b: number[];
let current = 0;
const sess: Record<string, number> = {};
const roles = ['allievo'] as const;

const mkUser = async (login: string) =>
  (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$1,'T') RETURNING id`, [login])).rows[0].id as number;
const state = (s: string) => pool.query('UPDATE school_years SET enrollment_state = $1 WHERE is_current', [s]);
const U = (id: number) => ({ id, roles });
// attività approvata con una sessione di `count` blocchi a partire dal blocco `start`
async function mk(key: string, org: number, max: number, start: number, count = 1, room: number | null = null) {
  const a = (await pool.query(
    `INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants, room_id, duration_blocks) VALUES ($1,$2,$3,'approvata',$4,$5,$6) RETURNING id`,
    [year, key, org, max, room, count])).rows[0].id;
  sess[key] = (await pool.query(
    `INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id, block_count) VALUES ($1,$2,$3,$4) RETURNING id`,
    [a, day, b[start], count])).rows[0].id;
}

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  day = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const org = await mkUser('org');
  const room = (await pool.query(`INSERT INTO rooms (name) VALUES ('Aula 1') RETURNING id`)).rows[0].id;
  await mk('A', org, 2, 0, 1, room); // blocco 1
  await mk('B', org, 5, 0); // blocco 1 (conflitto con A)
  await mk('C', org, 5, 1, 2); // blocchi 2-3
  await mk('D', org, 5, 2); // blocco 3 (conflitto con C)
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: current, roles } as never;
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

test('iscrizioni chiuse: rifiutate con messaggio, anche via pagina', async () => {
  const u = await mkUser('u1');
  await state('chiuse');
  await assert.rejects(enroll(pool, U(u), sess.A), /chiuse/);
  current = u;
  const r = await fetch(`${base}/iscrizione/${sess.A}`, { method: 'POST' });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /chiuse/);
});

test('solo organizzatori: passa chi ha un\'attività approvata, gli altri no', async () => {
  await state('solo_organizzatori');
  const u = await mkUser('u2');
  await assert.rejects(enroll(pool, U(u), sess.A), /solo a chi ha/);
  const org = (await pool.query(`SELECT id FROM users WHERE login_id = 'org'`)).rows[0].id;
  await enroll(pool, U(org), sess.A);
  await cancelEnrollment(pool, U(org), sess.A);
});

test('aperte: iscrizione, pulsanti, piena, stesso blocco, annullamento e posto liberato', async () => {
  await state('aperte');
  const [u1, u2, u3] = [await mkUser('p1'), await mkUser('p2'), await mkUser('p3')];
  current = u1;
  assert.equal((await fetch(`${base}/iscrizione/${sess.A}`, { method: 'POST' })).status, 200);
  assert.match(await (await fetch(`${base}/attivita`)).text(), /Annulla iscrizione/);
  await enroll(pool, U(u2), sess.A);
  await assert.rejects(enroll(pool, U(u3), sess.A), /piena/);
  await assert.rejects(enroll(pool, U(u1), sess.A), /già iscritto a questa/);
  await assert.rejects(enroll(pool, U(u1), sess.B), /stesso blocco/);
  await cancelEnrollment(pool, U(u1), sess.A);
  await enroll(pool, U(u3), sess.A); // il posto liberato è subito disponibile
  await enroll(pool, U(u1), sess.B); // e u1 ora può scegliere altro nel blocco
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments WHERE session_id = $1', [sess.A])).rows[0].n, 2);
});

test('sessioni lunghe: il conflitto vale su tutti i blocchi', async () => {
  const u = await mkUser('lng');
  await enroll(pool, U(u), sess.C);
  await assert.rejects(enroll(pool, U(u), sess.D), /stesso blocco/);
});

test('due iscrizioni simultanee all\'ultimo posto: una sola riesce (anche con 12 richieste)', async () => {
  await mk('E', (await pool.query(`SELECT id FROM users WHERE login_id='org'`)).rows[0].id, 3, 3);
  const users = await Promise.all(Array.from({ length: 12 }, (_, i) => mkUser(`c${i}`)));
  const res = await Promise.allSettled(users.map((id) => enroll(pool, U(id), sess.E)));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 3);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments WHERE session_id = $1', [sess.E])).rows[0].n, 3);
});

test('il trigger vieta di spostare iscrizioni e sessioni', async () => {
  await assert.rejects(pool.query('UPDATE activity_sessions SET start_block_id = $2 WHERE id = $1', [sess.A, b[3]]), /non si cambiano/);
  await assert.rejects(pool.query('UPDATE enrollments SET session_id = $1 WHERE session_id = $2', [sess.B, sess.A]), /non si sposta/);
});

test('conteggi per blocco: tutto lo span e il giorno', async () => {
  const load = await blockLoad(pool);
  assert.equal(load.get(`${day}:${b[2]}`)?.activities, 2); // D e il secondo blocco di C
  assert.equal(load.get(`${day}:${b[1]}`)?.activities, 1);
  assert.deepEqual((await listSessions(pool, { block: b[2] })).map((s) => s.block_count).sort(), [1, 2]);
  const busy = (await roomsWithUsage(pool)).find((r) => r.name === 'Aula 1')!.busy;
  assert.equal(busy.length, 1); // A occupa solo il blocco 1
});

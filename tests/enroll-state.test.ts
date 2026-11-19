import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';
import { homeRouter } from '../src/ui/home';
import { FakeTransport, setTransport } from '../src/mail/transport';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let roles: string[] = ['resp_ga'];
const fake = new FakeTransport();

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  setTransport(fake);
  for (const [login, role, pw] of [['a1@x.ch', 'allievo', 'h'], ['a2@x.ch', 'allievo', 'h'], ['d1@x.ch', 'docente', 'h'], ['r1@x.ch', 'relatore', 'h'], ['n1@x.ch', 'allievo', null]] as const) {
    const id = (await pool.query(`INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ($1,'N','C',$2) RETURNING id`, [login, pw])).rows[0].id;
    await pool.query('INSERT INTO user_roles VALUES ($1,$2)', [id, role]);
  }
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: 1, roles } as never;
    next();
  });
  app.use(homeRouter(pool));
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

const post = (path: string, body: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const state = async () => (await pool.query('SELECT enrollment_state s FROM school_years WHERE is_current')).rows[0].s;

test('stato iniziale chiuse, visibile in Home; i tre stati si impostano a mano', async () => {
  assert.equal(await state(), 'chiuse');
  assert.match(await (await fetch(`${base}/`)).text(), /Iscrizioni alle GA: <strong>Chiuse/);
  assert.equal((await post('/gestione-ga/stato', { state: 'solo_organizzatori' })).status, 200);
  assert.match(await (await fetch(`${base}/`)).text(), /Solo organizzatori/);
  assert.equal((await post('/gestione-ga/stato', { state: 'boh' })).status, 400);
  assert.equal(await state(), 'solo_organizzatori');
});

test('apri le iscrizioni: stato aperte, una mail a allievi e docenti registrati, secondo invio solo con conferma', async () => {
  const r = await post('/gestione-ga/apri');
  assert.equal(r.status, 200);
  assert.equal(await state(), 'aperte');
  const to = fake.outbox.flatMap((m) => m.bcc ?? []);
  assert.deepEqual(to.sort(), ['a1@x.ch', 'a2@x.ch', 'd1@x.ch']);
  const again = await post('/gestione-ga/apri');
  assert.equal(again.status, 400);
  assert.match(await again.text(), /già stata inviata/);
  assert.equal(fake.outbox.flatMap((m) => m.bcc ?? []).length, 3);
  assert.equal((await post('/gestione-ga/apri', { resend: '1' })).status, 200);
  assert.equal(fake.outbox.flatMap((m) => m.bcc ?? []).length, 6);
});

test('solo il Responsabile GA gestisce lo stato', async () => {
  roles = ['allievo'];
  assert.equal((await post('/gestione-ga/stato', { state: 'chiuse' })).status, 403);
  assert.equal((await fetch(`${base}/gestione-ga`)).status, 403);
  roles = ['resp_ga'];
});

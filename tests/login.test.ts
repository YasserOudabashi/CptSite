import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { authRouter } from '../src/auth/router';
import { sessionMiddleware } from '../src/auth/session';
import { requireRole } from '../src/auth/guard';
import { hashSecret } from '../src/auth/password';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: Server;
let base: string;
const PW = 'una-password-lunga';

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const hash = await hashSecret(PW);
  for (const id of ['u1@x.ch', 'u2@x.ch']) {
    const { rows } = await pool.query(
      `INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ($1,'A','B',$2) RETURNING id`,
      [id, hash],
    );
    await pool.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1,'allievo')`, [rows[0].id]);
  }
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware(pool));
  app.use(authRouter(pool));
  app.get('/protetta', requireRole('allievo'), (_req, res) => res.send('ok'));
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

const post = (path: string, body: Record<string, string>, cookie = '') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(body),
  });

test('pagina protetta senza login: redirect a /login', async () => {
  const r = await fetch(`${base}/protetta`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
});

test('login corretto: cookie HttpOnly/Secure/SameSite=Lax, accesso e logout lato server', async () => {
  const r = await post('/login', { loginId: 'U1@x.ch', password: PW });
  assert.equal(r.status, 303);
  const setCookie = r.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await fetch(`${base}/protetta`, { headers: { cookie } })).status, 200);
  const out = await post('/logout', {}, cookie);
  assert.equal(out.status, 303);
  // il cookie vecchio non vale più: la sessione è stata chiusa sul server
  const after = await fetch(`${base}/protetta`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(after.status, 302);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM sessions');
  assert.equal(rows[0].n, 0);
});

test('credenziali errate: messaggio generico; blocco dopo 5 tentativi falliti', async () => {
  const unknown = await post('/login', { loginId: 'nessuno@x.ch', password: 'xxxxxxxxxxxx' });
  const wrong = await post('/login', { loginId: 'u2@x.ch', password: 'sbagliata-sbagliata' });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(await unknown.text(), (await wrong.text()).replace('u2@x.ch', 'nessuno@x.ch'));
  for (let i = 0; i < 3; i++) await post('/login', { loginId: 'u2@x.ch', password: 'sbagliata-sbagliata' });
  // 4 errori finora + 1 = 5: ora è bloccato anche con la password giusta
  await post('/login', { loginId: 'u2@x.ch', password: 'sbagliata-sbagliata' });
  const locked = await post('/login', { loginId: 'u2@x.ch', password: PW });
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('set-cookie'), null);
});

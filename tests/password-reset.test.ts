import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { authRouter } from '../src/auth/router';
import { sessionMiddleware } from '../src/auth/session';
import { hashSecret, verifySecret } from '../src/auth/password';
import { completePasswordReset, requestPasswordReset } from '../src/auth/passwordReset';
import { FakeTransport, setTransport } from '../src/mail/transport';
import { login } from '../src/auth/session';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: Server;
let base: string;
const fake = new FakeTransport();
const PW = 'una-password-lunga';
const NEW = 'nuova-password-lunga';
let n = 0;
const ip = () => `10.8.0.${++n}`;

before(async () => {
  setTransport(fake);
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const hash = await hashSecret(PW);
  for (const id of ['r1@x.ch', 'r2@x.ch', 'r3@x.ch', 'r4@x.ch', 'r5@x.ch']) {
    await pool.query(`INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ($1,'A','B',$2)`, [id, hash]);
  }
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware(pool));
  app.use(authRouter(pool));
  server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

after(async () => {
  server.close();
  await stopDb();
});

const lastCode = () => /\n\s+(\d{8})\n/.exec(fake.outbox[fake.outbox.length - 1].text)![1];

test('ID esistente e inesistente: stessa risposta, mail solo per l’esistente', async () => {
  const before = fake.outbox.length;
  assert.deepEqual(await requestPasswordReset(pool, 'nessuno@x.ch', ip()), { ok: true });
  assert.equal(fake.outbox.length, before);
  assert.deepEqual(await requestPasswordReset(pool, 'R1@x.ch', ip()), { ok: true });
  assert.equal(fake.outbox.length, before + 1);
  assert.equal(fake.outbox[before].to, 'r1@x.ch');
  const a = await fetch(`${base}/recupero-password`, { method: 'POST', body: new URLSearchParams({ loginId: 'nessuno@x.ch' }) });
  const b = await fetch(`${base}/recupero-password`, { method: 'POST', body: new URLSearchParams({ loginId: 'r2@x.ch' }) });
  assert.equal(a.status, b.status);
  assert.equal(await a.text(), await b.text());
});

test('codice corretto: nuova password, monouso, sessioni precedenti chiuse', async () => {
  const old = await login(pool, 'r3@x.ch', PW);
  assert.equal(old.ok, true);
  await requestPasswordReset(pool, 'r3@x.ch', ip());
  const code = lastCode();
  const r = await completePasswordReset(pool, { loginId: 'r3@x.ch', code, password: NEW, password2: NEW });
  assert.deepEqual(r, { ok: true });
  const { rows } = await pool.query(`SELECT password_hash, id FROM users WHERE login_id = 'r3@x.ch'`);
  assert.equal(await verifySecret(NEW, rows[0].password_hash), true);
  const s = await pool.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [rows[0].id]);
  assert.equal(s.rows[0].n, 0);
  assert.equal((await login(pool, 'r3@x.ch', NEW)).ok, true);
  const again = await completePasswordReset(pool, { loginId: 'r3@x.ch', code, password: NEW, password2: NEW });
  assert.deepEqual(again, { ok: false, reason: 'bad_code' });
});

test('codice scaduto (30 minuti) o sbagliato: rifiutato; password corta/diversa: codice ancora valido', async () => {
  await requestPasswordReset(pool, 'r4@x.ch', ip());
  const code = lastCode();
  const bad = await completePasswordReset(pool, { loginId: 'r4@x.ch', code: '00000000', password: NEW, password2: NEW });
  assert.deepEqual(bad, { ok: false, reason: 'bad_code' });
  const short = await completePasswordReset(pool, { loginId: 'r4@x.ch', code, password: 'corta', password2: 'corta' });
  assert.deepEqual(short, { ok: false, reason: 'password_short' });
  const diff = await completePasswordReset(pool, { loginId: 'r4@x.ch', code, password: NEW, password2: NEW + 'x' });
  assert.deepEqual(diff, { ok: false, reason: 'password_mismatch' });
  const { rows } = await pool.query(
    `UPDATE password_resets SET expires_at = now() - interval '1 minute'
     WHERE user_id = (SELECT id FROM users WHERE login_id = 'r4@x.ch') RETURNING 1`,
  );
  assert.equal(rows.length, 1);
  const late = await completePasswordReset(pool, { loginId: 'r4@x.ch', code, password: NEW, password2: NEW });
  assert.deepEqual(late, { ok: false, reason: 'bad_code' });
});

test('errore SMTP: nessun codice resta valido; limite di 5 richieste e 5 verifiche all’ora', async () => {
  fake.failNext = 1;
  assert.deepEqual(await requestPasswordReset(pool, 'r5@x.ch', ip()), { ok: false, reason: 'mail_failed' });
  const { rows } = await pool.query(`SELECT 1 FROM password_resets WHERE user_id = (SELECT id FROM users WHERE login_id = 'r5@x.ch')`);
  assert.equal(rows.length, 0);
  // 1 richiesta già fatta per r5: altre 4 passano, la sesta no
  for (let i = 0; i < 4; i++) assert.equal((await requestPasswordReset(pool, 'r5@x.ch', ip())).ok, true);
  assert.deepEqual(await requestPasswordReset(pool, 'r5@x.ch', ip()), { ok: false, reason: 'rate_limited' });
  for (let i = 0; i < 5; i++) {
    await completePasswordReset(pool, { loginId: 'r5@x.ch', code: '11111111', password: NEW, password2: NEW });
  }
  const code = lastCode();
  const blocked = await completePasswordReset(pool, { loginId: 'r5@x.ch', code, password: NEW, password2: NEW });
  assert.deepEqual(blocked, { ok: false, reason: 'rate_limited' });
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { app as realApp } from '../src/app';
import { login } from '../src/auth/session';
import { hashSecret } from '../src/auth/password';
import { startRegistration } from '../src/auth/registration';
import { requestPasswordReset } from '../src/auth/passwordReset';
import { FakeTransport, setTransport } from '../src/mail/transport';
import { cleanupExpired } from '../src/mail/queue';

let pool: Pool;
let stopDb: () => Promise<void>;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  setTransport(new FakeTransport());
  await pool.query(`INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ('u@x.ch','U','U',$1)`, [await hashSecret('giusta-password-1')]);
});
after(async () => stopDb());

test('CSRF: POST con Origin/Referer diverso da SITE_URL rifiutata, uguale accettata', async () => {
  process.env.SITE_URL = 'https://ga.example.ch';
  realApp.post('/__csrf', (_req, res) => void res.send('ok'));
  const server: import('node:http').Server = await new Promise((r) => {
    const s = realApp.listen(0, () => r(s));
  });
  const base = `http://localhost:${(server.address() as { port: number }).port}/__csrf`;
  try {
    const post = (h: Record<string, string>) => fetch(base, { method: 'POST', headers: h });
    assert.equal((await post({ origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ referer: 'https://evil.example/x' })).status, 403);
    assert.equal((await post({ origin: 'https://ga.example.ch' })).status, 200);
    assert.equal((await post({ referer: 'https://ga.example.ch/login' })).status, 200);
    assert.equal((await fetch(base)).status, 404); // GET non è toccata dal controllo
  } finally {
    delete process.env.SITE_URL;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('login: al massimo 5 tentativi per (ID, IP) in parallelo, poi blocco; un altro IP non è bloccato', async () => {
  const res = await Promise.all(Array.from({ length: 10 }, () => login(pool, 'u@x.ch', 'sbagliata', '1.1.1.1')));
  assert.ok(res.filter((r) => !r.ok && r.reason === 'invalid').length <= 5);
  assert.ok(res.some((r) => !r.ok && r.reason === 'locked'));
  assert.equal((await login(pool, 'u@x.ch', 'giusta-password-1', '1.1.1.1')).ok, false); // ancora bloccato
  assert.equal((await login(pool, 'u@x.ch', 'giusta-password-1', '2.2.2.2')).ok, true);
});

test('registrazione e recupero: 5 per ID in parallelo; limite per IP da RATE_LIMIT_IP_PER_HOUR', async () => {
  const input = (loginId: string, ip: string) => ({ loginId, generalCode: 'no', firstName: 'a', lastName: 'b', className: 'c', ip });
  const reg = await Promise.all(Array.from({ length: 10 }, (_, i) => startRegistration(pool, input('par@studenti.edu.ti.ch', `9.9.0.${i}`))));
  assert.ok(reg.filter((r) => !(!r.ok && r.reason === 'rate_limited')).length <= 5); // al massimo 5 passano (con richieste parallele anche meno)
  const rst = await Promise.all(Array.from({ length: 10 }, (_, i) => requestPasswordReset(pool, 'nessuno@x.ch', `9.9.1.${i}`)));
  assert.ok(rst.filter((r) => r.ok).length <= 5);
  process.env.RATE_LIMIT_IP_PER_HOUR = '3';
  try {
    const ip = await Promise.all(Array.from({ length: 6 }, (_, i) => startRegistration(pool, input(`ip${i}@studenti.edu.ti.ch`, '8.8.8.8'))));
    assert.ok(ip.filter((r) => !(!r.ok && r.reason === 'rate_limited')).length <= 3);
    assert.ok(ip.some((r) => !r.ok && r.reason === 'rate_limited'));
  } finally {
    delete process.env.RATE_LIMIT_IP_PER_HOUR;
  }
});

test('pulizia: via i record scaduti da più di un giorno, restano i recenti', async () => {
  await pool.query(`INSERT INTO login_failures (login_id, ip, created_at) VALUES ('old','', now() - interval '2 days'), ('new','', now())`);
  await pool.query(`INSERT INTO registration_attempts (kind, key, created_at) VALUES ('id','old', now() - interval '2 days')`);
  await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) SELECT 'old', id, now() - interval '2 days' FROM users LIMIT 1`);
  await pool.query(`INSERT INTO registration_codes (login_id, first_name, last_name, class_name, code_hash, expires_at) VALUES ('old','a','b','c','h', now() - interval '2 days')`);
  await cleanupExpired(pool);
  assert.deepEqual((await pool.query(`SELECT login_id FROM login_failures WHERE login_id IN ('old','new')`)).rows, [{ login_id: 'new' }]);
  assert.equal((await pool.query(`SELECT 1 FROM registration_attempts WHERE key = 'old'`)).rowCount, 0);
  assert.equal((await pool.query(`SELECT 1 FROM sessions WHERE token_hash = 'old'`)).rowCount, 0);
  assert.equal((await pool.query(`SELECT 1 FROM registration_codes WHERE login_id = 'old'`)).rowCount, 0);
});

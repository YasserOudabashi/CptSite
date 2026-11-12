import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { authRouter } from '../src/auth/router';
import { startRegistration } from '../src/auth/registration';
import { importStudentIds, setGeneralCode } from '../src/admin/studentList';
import { FakeTransport, setTransport } from '../src/mail/transport';
import { verifySecret } from '../src/auth/password';

let pool: Pool;
let stopDb: () => Promise<void>;
const fake = new FakeTransport();

const input = (over: Partial<Parameters<typeof startRegistration>[1]> = {}) => ({
  loginId: 'abc123@studenti.edu.ti.ch',
  generalCode: 'cpt-2026',
  firstName: 'Anna',
  lastName: 'Rossi',
  className: 'I3A',
  ip: '10.0.0.1',
  ...over,
});

before(async () => {
  process.env.SCHOOL_DOMAIN = 'studenti.edu.ti.ch';
  setTransport(fake);
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  await setGeneralCode(pool, 'cpt-2026');
});

after(async () => {
  await stopDb();
});

test('registrazione valida: codice salvato hashato, scadenza 24 ore, mail inviata', async () => {
  const r = await startRegistration(pool, input());
  assert.deepEqual(r, { ok: true });
  assert.equal(fake.outbox.length, 1);
  assert.equal(fake.outbox[0].to, 'abc123@studenti.edu.ti.ch');
  const code = /\n\s+(\d{8})\n/.exec(fake.outbox[0].text)![1];
  const { rows } = await pool.query(
    `SELECT code_hash, expires_at - now() AS left FROM registration_codes`,
  );
  assert.ok(!rows[0].code_hash.includes(code));
  assert.equal(await verifySecret(code, rows[0].code_hash), true);
  assert.ok(rows[0].left.hours === 23 || rows[0].left.hours === 24 || rows[0].left.days === 1);
});

test('errori generici: codice generale sbagliato e dominio sbagliato', async () => {
  const a = await startRegistration(pool, input({ loginId: 'x1@studenti.edu.ti.ch', generalCode: 'no', ip: '10.0.0.2' }));
  const b = await startRegistration(pool, input({ loginId: 'x2@gmail.com', ip: '10.0.0.3' }));
  assert.deepEqual(a, { ok: false, reason: 'invalid' });
  assert.deepEqual(b, { ok: false, reason: 'invalid' });
  assert.equal(fake.outbox.length, 1);
});

test('ID fuori dall\'elenco caricato rifiutato', async () => {
  await importStudentIds(pool, 'solo@studenti.edu.ti.ch');
  const r = await startRegistration(pool, input({ loginId: 'altro@studenti.edu.ti.ch', ip: '10.0.0.4' }));
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
  await pool.query('DELETE FROM student_ids');
});

test('ID già registrato: messaggio dedicato', async () => {
  await pool.query(`INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ('old1@studenti.edu.ti.ch','A','B','x')`);
  const r = await startRegistration(pool, input({ loginId: 'OLD1@studenti.edu.ti.ch', ip: '10.0.0.5' }));
  assert.deepEqual(r, { ok: false, reason: 'exists' });
});

test('errore SMTP: nessun codice resta valido', async () => {
  fake.failNext = 1;
  const r = await startRegistration(pool, input({ loginId: 'smtp1@studenti.edu.ti.ch', ip: '10.0.0.6' }));
  assert.deepEqual(r, { ok: false, reason: 'mail_failed' });
  const { rowCount } = await pool.query(`SELECT 1 FROM registration_codes WHERE login_id = 'smtp1@studenti.edu.ti.ch'`);
  assert.equal(rowCount, 0);
});

test('limite 5 tentativi/ora per ID e per IP', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await startRegistration(pool, input({ loginId: 'lim@studenti.edu.ti.ch', generalCode: 'no', ip: `10.1.0.${i}` }));
    assert.equal(r.ok === false && r.reason, 'invalid');
  }
  const byId = await startRegistration(pool, input({ loginId: 'lim@studenti.edu.ti.ch', ip: '10.1.0.99' }));
  assert.deepEqual(byId, { ok: false, reason: 'rate_limited' });
  for (let i = 0; i < 5; i++) {
    await startRegistration(pool, input({ loginId: `ip${i}@studenti.edu.ti.ch`, generalCode: 'no', ip: '10.2.0.1' }));
  }
  const byIp = await startRegistration(pool, input({ loginId: 'fresh@studenti.edu.ti.ch', ip: '10.2.0.1' }));
  assert.deepEqual(byIp, { ok: false, reason: 'rate_limited' });
});

test('pagina /registrazione via HTTP', async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(authRouter(pool));
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/registrazione`)).status, 200);
    const bad = await fetch(`${base}/registrazione`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ loginId: 'h1@studenti.edu.ti.ch', generalCode: 'no', firstName: 'a', lastName: 'b', className: 'c' }),
    });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /ID o codice generale non validi/);
    const ok = await fetch(`${base}/registrazione`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ loginId: 'h2@studenti.edu.ti.ch', generalCode: 'cpt-2026', firstName: 'a', lastName: 'b', className: 'c' }),
    });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Controlla la tua mail/);
  } finally {
    server.close();
  }
});

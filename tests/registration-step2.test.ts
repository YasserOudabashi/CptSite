import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { authRouter } from '../src/auth/router';
import { completeRegistration, startRegistration } from '../src/auth/registration';
import { setGeneralCode } from '../src/admin/studentList';
import { FakeTransport, setTransport } from '../src/mail/transport';
import { verifySecret } from '../src/auth/password';
import { getUserRoles } from '../src/users/roles';

let pool: Pool;
let stopDb: () => Promise<void>;
const fake = new FakeTransport();
let n = 0;

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

// Esegue il passo 1 e restituisce il codice personale letto dalla mail finta.
async function step1(loginId: string): Promise<string> {
  const r = await startRegistration(pool, {
    loginId, generalCode: 'cpt-2026', firstName: 'Anna', lastName: 'Rossi', className: 'I3A', ip: `10.9.0.${++n}`,
  });
  assert.deepEqual(r, { ok: true });
  return /\n\s+(\d{8})\n/.exec(fake.outbox[fake.outbox.length - 1].text)![1];
}

const PW = 'una-password-lunga';

test('codice corretto: utente creato con ruolo allievo e password hashata', async () => {
  const code = await step1('s1@studenti.edu.ti.ch');
  const r = await completeRegistration(pool, { loginId: 's1@studenti.edu.ti.ch', code, password: PW, password2: PW });
  assert.deepEqual(r, { ok: true });
  const { rows } = await pool.query(`SELECT id, first_name, class_name, password_hash FROM users WHERE login_id = 's1@studenti.edu.ti.ch'`);
  assert.equal(rows[0].first_name, 'Anna');
  assert.equal(rows[0].class_name, 'I3A');
  assert.notEqual(rows[0].password_hash, PW);
  assert.equal(await verifySecret(PW, rows[0].password_hash), true);
  assert.deepEqual(await getUserRoles(pool, rows[0].id), ['allievo']);
  // codice monouso
  const again = await completeRegistration(pool, { loginId: 's1@studenti.edu.ti.ch', code, password: PW, password2: PW });
  assert.deepEqual(again, { ok: false, reason: 'bad_code' });
});

test('password corta o diversa: rifiutata, codice ancora valido', async () => {
  const code = await step1('s2@studenti.edu.ti.ch');
  const short = await completeRegistration(pool, { loginId: 's2@studenti.edu.ti.ch', code, password: 'corta', password2: 'corta' });
  assert.deepEqual(short, { ok: false, reason: 'password_short' });
  const diff = await completeRegistration(pool, { loginId: 's2@studenti.edu.ti.ch', code, password: PW, password2: PW + 'x' });
  assert.deepEqual(diff, { ok: false, reason: 'password_mismatch' });
  const ok = await completeRegistration(pool, { loginId: 's2@studenti.edu.ti.ch', code, password: PW, password2: PW });
  assert.deepEqual(ok, { ok: true });
});

test('codice sbagliato o scaduto: errore, nessun utente', async () => {
  const code = await step1('s3@studenti.edu.ti.ch');
  const wrong = await completeRegistration(pool, { loginId: 's3@studenti.edu.ti.ch', code: '00000000' === code ? '11111111' : '00000000', password: PW, password2: PW });
  assert.deepEqual(wrong, { ok: false, reason: 'bad_code' });
  await pool.query(`UPDATE registration_codes SET expires_at = now() - interval '1 minute' WHERE login_id = 's3@studenti.edu.ti.ch'`);
  const expired = await completeRegistration(pool, { loginId: 's3@studenti.edu.ti.ch', code, password: PW, password2: PW });
  assert.deepEqual(expired, { ok: false, reason: 'bad_code' });
  const { rowCount } = await pool.query(`SELECT 1 FROM users WHERE login_id = 's3@studenti.edu.ti.ch'`);
  assert.equal(rowCount, 0);
  // nuovo codice richiesto rifacendo il passo 1
  const fresh = await step1('s3@studenti.edu.ti.ch');
  assert.deepEqual(await completeRegistration(pool, { loginId: 's3@studenti.edu.ti.ch', code: fresh, password: PW, password2: PW }), { ok: true });
});

test('limite 5 tentativi/ora sul codice', async () => {
  const code = await step1('s4@studenti.edu.ti.ch');
  for (let i = 0; i < 5; i++) {
    const r = await completeRegistration(pool, { loginId: 's4@studenti.edu.ti.ch', code: '12345678' === code ? '87654321' : '12345678', password: PW, password2: PW });
    assert.equal(r.ok === false && r.reason, 'bad_code');
  }
  const blocked = await completeRegistration(pool, { loginId: 's4@studenti.edu.ti.ch', code, password: PW, password2: PW });
  assert.deepEqual(blocked, { ok: false, reason: 'rate_limited' });
});

test('pagina /registrazione/codice via HTTP', async () => {
  const code = await step1('s5@studenti.edu.ti.ch');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(authRouter(pool));
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const post = (body: Record<string, string>) =>
    fetch(`${base}/registrazione/codice`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  try {
    assert.equal((await fetch(`${base}/registrazione/codice`)).status, 200);
    const bad = await post({ loginId: 's5@studenti.edu.ti.ch', code: 'x', password: PW, password2: PW });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /Richiedi un nuovo codice/);
    const ok = await post({ loginId: 's5@studenti.edu.ti.ch', code, password: PW, password2: PW });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Account attivato/);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

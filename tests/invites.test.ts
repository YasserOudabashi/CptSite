import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { adminRouter } from '../src/admin/router';
import { authRouter } from '../src/auth/router';
import { acceptInvite, createInvite } from '../src/admin/invites';
import { login } from '../src/auth/session';
import { getUserRoles } from '../src/users/roles';

let pool: Pool;
let stopDb: () => Promise<void>;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
});

after(async () => {
  await stopDb();
});

const mk = (role: string, email: string) => createInvite(pool, { role, firstName: 'Luca', lastName: 'Bianchi', email });

test('invito docente: l\'utente nasce con il ruolo giusto, senza classe, e il link è monouso', async () => {
  const token = await mk('docente', 'luca.bianchi@edu.ti.ch');
  assert.deepEqual(await acceptInvite(pool, token, 'password-lunga-1', 'diversa-password'), { ok: false, reason: 'password_mismatch' });
  assert.deepEqual(await acceptInvite(pool, token, 'corta', 'corta'), { ok: false, reason: 'password_short' });
  assert.deepEqual(await acceptInvite(pool, token, 'password-lunga-1', 'password-lunga-1'), { ok: true });
  const { rows } = await pool.query(`SELECT id, class_name FROM users WHERE login_id = 'luca.bianchi@edu.ti.ch'`);
  assert.equal(rows[0].class_name, null);
  assert.deepEqual(await getUserRoles(pool, rows[0].id), ['docente']);
  assert.equal((await login(pool, 'luca.bianchi@edu.ti.ch', 'password-lunga-1')).ok, true);
  assert.deepEqual(await acceptInvite(pool, token, 'password-lunga-1', 'password-lunga-1'), { ok: false, reason: 'invalid' });
});

test('invito relatore, scaduto, tipo non valido, utente già esistente', async () => {
  const token = await mk('relatore', 'ext@azienda.ch');
  await pool.query(`UPDATE invites SET expires_at = now() - interval '1 minute'`);
  assert.deepEqual(await acceptInvite(pool, token, 'password-lunga-1', 'password-lunga-1'), { ok: false, reason: 'invalid' });
  await assert.rejects(mk('allievo', 'x@y.ch'), /Tipo/);
  await assert.rejects(mk('docente', 'luca.bianchi@edu.ti.ch'), /già/);
  const t2 = await mk('relatore', 'ext2@azienda.ch');
  await acceptInvite(pool, t2, 'password-lunga-1', 'password-lunga-1');
  const { rows } = await pool.query(`SELECT id FROM users WHERE login_id = 'ext2@azienda.ch'`);
  assert.deepEqual(await getUserRoles(pool, rows[0].id), ['relatore']);
});

test('pagine: solo Responsabile sito crea inviti; il link porta alla registrazione', async () => {
  let user: express.Request['user'];
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(adminRouter(pool));
  app.use(authRouter(pool));
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: Record<string, string>) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  try {
    const form = { role: 'docente', firstName: 'Mara', lastName: 'Verdi', email: 'mara@edu.ti.ch' };
    user = { id: 1, roles: ['resp_ga'] };
    assert.equal((await fetch(`${base}/admin/inviti`)).status, 403);
    assert.equal((await post('/admin/inviti', form)).status, 403);
    user = { id: 1, roles: ['resp_sito'] };
    const html = await (await post('/admin/inviti', form)).text();
    const link = /value="[^"]*(\/invito\/[\w-]+)"/.exec(html)![1];
    user = undefined;
    const g = await fetch(`${base}${link}`);
    assert.equal(g.status, 200);
    assert.match(await g.text(), /mara@edu\.ti\.ch/);
    const bad = await post(link, { password: 'password-lunga-1', password2: 'altra-password-1' });
    assert.equal(bad.status, 400);
    const ok = await post(link, { password: 'password-lunga-1', password2: 'password-lunga-1' });
    assert.match(await ok.text(), /Account attivato/);
    const again = await fetch(`${base}${link}`);
    assert.equal(again.status, 410);
    assert.match(await again.text(), /scaduto o è già stato usato/);
    assert.equal((await fetch(`${base}/invito/inesistente`)).status, 410);
  } finally {
    server.close();
  }
});

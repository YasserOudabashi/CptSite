import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { adminRouter } from '../src/admin/router';
import { addUserRole, dropUserRole, searchUsers } from '../src/admin/users';
import { getUserRoles } from '../src/users/roles';

let pool: Pool;
let stopDb: () => Promise<void>;
let anna: number;
let adminId: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const r = await pool.query(
    `INSERT INTO users (login_id, first_name, last_name) VALUES ('anna@studenti.edu.ti.ch','Anna','Rossi') RETURNING id`,
  );
  anna = r.rows[0].id;
  await pool.query(`INSERT INTO user_roles VALUES ($1,'allievo')`, [anna]);
  adminId = (await pool.query(`SELECT user_id FROM user_roles WHERE role_code='resp_sito'`)).rows[0].user_id;
});

after(async () => {
  await stopDb();
});

test('ricerca per nome e per ID, con i ruoli attuali', async () => {
  const byName = await searchUsers(pool, 'ross');
  assert.equal(byName.length, 1);
  assert.deepEqual(byName[0].roles, ['allievo']);
  assert.equal((await searchUsers(pool, 'anna@studenti')).length, 1);
  assert.equal((await searchUsers(pool, 'zzz')).length, 0);
});

test('più ruoli per utente, incluso Responsabile GA', async () => {
  await addUserRole(pool, anna, 'resp_ga');
  await addUserRole(pool, anna, 'docente');
  assert.deepEqual(await getUserRoles(pool, anna), ['allievo', 'docente', 'resp_ga']);
  await dropUserRole(pool, anna, 'docente');
  assert.deepEqual(await getUserRoles(pool, anna), ['allievo', 'resp_ga']);
  await assert.rejects(addUserRole(pool, anna, 'inventato'));
});

test('non si può togliere l\'ultimo Responsabile sito', async () => {
  await assert.rejects(dropUserRole(pool, adminId, 'resp_sito'), /ultimo/);
  await addUserRole(pool, anna, 'resp_sito');
  await dropUserRole(pool, adminId, 'resp_sito');
  await assert.rejects(dropUserRole(pool, anna, 'resp_sito'), /ultimo/);
  assert.ok((await getUserRoles(pool, anna)).includes('resp_sito'));
});

test('pagina: solo Responsabile sito; aggiungi e togli via HTTP', async () => {
  let user: express.Request['user'];
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(adminRouter(pool));
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
    user = { id: 1, roles: ['resp_ga'] };
    assert.equal((await fetch(`${base}/admin/utenti`)).status, 403);
    assert.equal((await post('/admin/utenti/ruolo/aggiungi', { user: String(anna), role: 'relatore' })).status, 403);
    user = { id: adminId, roles: ['resp_sito'] };
    const page = await (await fetch(`${base}/admin/utenti?q=rossi`)).text();
    assert.match(page, /Rossi Anna/);
    await post('/admin/utenti/ruolo/aggiungi', { user: String(anna), role: 'relatore' });
    assert.ok((await getUserRoles(pool, anna)).includes('relatore'));
    const html = await (await post('/admin/utenti/ruolo/togli', { user: String(anna), role: 'relatore' })).text();
    assert.match(html, /Ruoli aggiornati/);
    assert.ok(!(await getUserRoles(pool, anna)).includes('relatore'));
  } finally {
    server.close();
  }
});

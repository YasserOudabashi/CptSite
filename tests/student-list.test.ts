import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { adminRouter } from '../src/admin/router';
import {
  checkGeneralCode,
  importStudentIds,
  isAllowedStudentId,
  setGeneralCode,
} from '../src/admin/studentList';

let pool: Pool;
let stopDb: () => Promise<void>;

before(async () => {
  process.env.SCHOOL_DOMAIN = 'studenti.edu.ti.ch';
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
});

after(async () => {
  await stopDb();
});

test('elenco vuoto: basta il dominio scolastico', async () => {
  assert.equal(await isAllowedStudentId(pool, 'abc123@studenti.edu.ti.ch'), true);
  assert.equal(await isAllowedStudentId(pool, 'abc123@gmail.com'), false);
});

test('import: duplicati ignorati, righe non valide con numero di riga', async () => {
  const r = await importStudentIds(
    pool,
    'ID\nssl586@studenti.edu.ti.ch\n\nSSL586@studenti.edu.ti.ch\nnonvalido\nxyz001@studenti.edu.ti.ch\n',
  );
  assert.equal(r.added, 2);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.errors, [{ line: 5, value: 'nonvalido' }]);
});

test('elenco caricato: solo gli ID presenti; aggiornabile senza toccare gli altri', async () => {
  assert.equal(await isAllowedStudentId(pool, 'ssl586@studenti.edu.ti.ch'), true);
  assert.equal(await isAllowedStudentId(pool, 'abc123@studenti.edu.ti.ch'), false);
  const r = await importStudentIds(pool, 'abc123@studenti.edu.ti.ch\nssl586@studenti.edu.ti.ch');
  assert.equal(r.added, 1);
  assert.equal(await isAllowedStudentId(pool, 'abc123@studenti.edu.ti.ch'), true);
});

test('codice generale salvato hashato e verificabile', async () => {
  await setGeneralCode(pool, 'cpt-2026');
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'general_code_hash'`);
  assert.ok(!rows[0].value.includes('cpt-2026'));
  assert.equal(await checkGeneralCode(pool, 'cpt-2026'), true);
  assert.equal(await checkGeneralCode(pool, 'sbagliato'), false);
});

test('pagina admin: redirect al login senza accesso, 403 senza ruolo, 200 per resp_sito', async () => {
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
  try {
    user = undefined;
    const anon = await fetch(`${base}/admin/studenti`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/login');
    user = { id: 1, roles: ['resp_ga'] };
    assert.equal((await fetch(`${base}/admin/studenti`)).status, 403);
    user = { id: 1, roles: ['allievo', 'resp_sito'] };
    assert.equal((await fetch(`${base}/admin/studenti`)).status, 200);
    const res = await fetch(`${base}/admin/studenti`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csv: 'new1@studenti.edu.ti.ch\nbad' }),
    });
    const html = await res.text();
    assert.match(html, /Riga 2: bad/);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

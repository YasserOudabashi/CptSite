import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { adminRouter } from '../src/admin/router';
import {
  addGaDay,
  createSchoolYear,
  gaDatesLabel,
  listBlocks,
  listGaDays,
  setCurrentSchoolYear,
  updateBlock,
} from '../src/admin/settings';
import { getCurrentSchoolYear } from '../src/users/roles';

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

test('nuovo anno scolastico e cambio dell\'anno corrente (sempre uno solo)', async () => {
  await createSchoolYear(pool, '2027-2028');
  await assert.rejects(createSchoolYear(pool, '2027-2028'), /esistente/);
  await assert.rejects(createSchoolYear(pool, 'boh'), /non valido/);
  const { rows } = await pool.query(`SELECT id FROM school_years WHERE name = '2027-2028'`);
  await setCurrentSchoolYear(pool, rows[0].id);
  assert.equal((await getCurrentSchoolYear(pool)).name, '2027-2028');
  const { rows: cur } = await pool.query('SELECT count(*)::int AS n FROM school_years WHERE is_current');
  assert.equal(cur[0].n, 1);
  await assert.rejects(setCurrentSchoolYear(pool, 9999), /inesistente/);
  assert.equal((await getCurrentSchoolYear(pool)).name, '2027-2028');
  const { rows: first } = await pool.query(`SELECT id FROM school_years WHERE name = '2026-2027'`);
  await setCurrentSchoolYear(pool, first[0].id);
});

test('blocchi orari: valori iniziali e modifica', async () => {
  const blocks = await listBlocks(pool);
  assert.deepEqual(
    blocks.map((b) => `${b.name} ${b.start}-${b.end}`),
    ['Blocco 1 08:30-10:00', 'Pausa 10:00-10:15', 'Blocco 2 10:15-11:45', 'Pranzo 11:45-12:45', 'Blocco 3 12:45-14:15', 'Pausa 14:15-14:30', 'Blocco 4 14:30-16:00'],
  );
  await updateBlock(pool, blocks[0].id, 'Primo blocco', '08:45', '10:00');
  assert.equal((await listBlocks(pool))[0].start, '08:45');
  await assert.rejects(updateBlock(pool, blocks[0].id, 'x', '10:00', '09:00'), /dopo/);
  await assert.rejects(updateBlock(pool, blocks[0].id, 'x', '8:30', '10:00'), /Orario/);
  await assert.rejects(updateBlock(pool, blocks[0].id, ' ', '08:30', '10:00'), /nome/);
});

test('date GA: da definire, aggiunta e rimozione dell\'anno corrente', async () => {
  assert.equal(gaDatesLabel(await listGaDays(pool)), 'da definire');
  await addGaDay(pool, '2027-05-12');
  await addGaDay(pool, '');
  const days = await listGaDays(pool);
  assert.equal(days.length, 2);
  assert.equal(gaDatesLabel(days), '12.05.2027');
  await assert.rejects(addGaDay(pool, '2027-13-45'), /non valida/);
});

test('pagina impostazioni e QR: solo Responsabile sito, QR è un PNG', async () => {
  let roles: string[] = ['resp_ga'];
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: 1, roles } as never;
    next();
  });
  app.use(adminRouter(pool));
  const server = await new Promise<import('node:http').Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/admin/impostazioni`)).status, 403);
    assert.equal((await fetch(`${base}/admin/impostazioni/qr.png`)).status, 403);
    roles = ['resp_sito'];
    const html = await (await fetch(`${base}/admin/impostazioni`)).text();
    assert.match(html, /Primo blocco/);
    assert.match(html, /qr\.png/);
    const qr = await fetch(`${base}/admin/impostazioni/qr.png`);
    assert.equal(qr.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await qr.arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    const res = await fetch(`${base}/admin/impostazioni/blocco`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id: String((await listBlocks(pool))[2].id), name: 'Blocco 2', start: '10:20', end: '11:45' }),
    });
    assert.match(await res.text(), /Salvato/);
    assert.equal((await listBlocks(pool))[2].start, '10:20');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

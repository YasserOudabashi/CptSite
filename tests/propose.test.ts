import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';
import { blockSpan, createProposal, parseProposal } from '../src/ga/proposals';
import { listBlocks } from '../src/admin/settings';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let uid: number;
let b: number[];
let roles = ['allievo'];

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('p@x.ch','Pia','Verdi') RETURNING id`)).rows[0].id;
  b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  await pool.query(`INSERT INTO rooms (name) VALUES ('Aula 7')`);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: uid, roles } as never;
    next();
  });
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

const ok = { title: 'Scacchi', description: 'Torneo', phone: '079 1', max: '10', min: '2', duration: '1' };
const form = (o: Record<string, string>) => parseProposal({ ...ok, first: String(b[0]), second: String(b[1]), ...o });

test('blockSpan: due blocchi consecutivi sì, attraverso il pranzo o oltre la fine no', async () => {
  const blocks = await listBlocks(pool);
  assert.equal(blockSpan(blocks, b[0], 2)?.length, 2); // Blocco 1 + 2 (pausa breve)
  assert.equal(blockSpan(blocks, b[1], 2), null); // Blocco 2 + 3: pranzo in mezzo
  assert.equal(blockSpan(blocks, b[2], 2)?.length, 2); // Blocco 3 + 4
  assert.equal(blockSpan(blocks, b[3], 2), null); // oltre la fine
});

test('createProposal: stato "proposta" e controlli', async () => {
  const id = await createProposal(pool, uid, form({ repeat: '1' }));
  const a = (await pool.query('SELECT status, repetitions, organizer_id FROM activities WHERE id = $1', [id])).rows[0];
  assert.deepEqual(a, { status: 'proposta', repetitions: 2, organizer_id: uid });
  await assert.rejects(createProposal(pool, uid, form({ min: '11' })), /minimo/);
  await assert.rejects(createProposal(pool, uid, form({ second: String(b[0]) })), /diverse/);
  await assert.rejects(createProposal(pool, uid, form({ title: ' ' })), /obbligatori/);
  await assert.rejects(createProposal(pool, uid, form({ first: String(b[1]), second: String(b[0]), duration: '2' })), /pranzo/);
  await assert.rejects(createProposal(pool, uid, form({ first: '' })), /Scegli/);
});

test('pagina /proponi: modulo con orari, invio, errore, permesso', async () => {
  const html = await (await fetch(`${base}/proponi`)).text();
  assert.match(html, /Blocco 1 · 8:30–10:00/);
  assert.match(html, /Pia Verdi/);
  assert.match(html, /Aula 7 — libera/);
  const post = (o: Record<string, string>) =>
    fetch(`${base}/proponi`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...ok, first: String(b[0]), second: String(b[1]), ...o }),
    });
  const good = await post({ title: 'Yoga' });
  assert.equal(good.status, 200);
  assert.match(await good.text(), /Proposta inviata/);
  const bad = await post({ max: '1', min: '5' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /minimo/);
  roles = [];
  assert.equal((await fetch(`${base}/proponi`)).status, 403);
  roles = ['allievo'];
  // una proposta non è visibile nell'elenco
  assert.doesNotMatch(await (await fetch(`${base}/attivita`)).text(), /Yoga/);
});

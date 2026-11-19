import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';
import { createProposal, parseProposal } from '../src/ga/proposals';
import { approveProposal, materialsCsv, materialsList } from '../src/ga/approval';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let uid: number;
let b: number[];
let roles = ['resp_ga'];

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('p@x.ch','Pia','Verdi') RETURNING id`)).rows[0].id;
  b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
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

const propose = (o: Record<string, string> = {}) =>
  createProposal(pool, uid, parseProposal({ title: 'Scacchi', description: 'Torneo', phone: '1', max: '10', first: String(b[0]), second: String(b[1]), ...o }));
const post = (path: string, o: Record<string, string>) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
const edit = { title: 'Scacchi', description: 'Torneo', contact: '1', roomId: null, materials: '=cmd', min: 0, max: 10 };

test('approvazione: crea le sessioni, usa un giorno "da definire" se non ce ne sono', async () => {
  const id = await propose({ repeat: '1' });
  await assert.rejects(approveProposal(pool, id, edit, [b[0]]), /blocco di ogni/);
  await assert.rejects(approveProposal(pool, id, edit, [b[0], b[0]]), /diversi/);
  await approveProposal(pool, id, { ...edit, max: 12 }, [b[2], b[3]]);
  const { rows } = await pool.query('SELECT repeat_no, start_block_id FROM activity_sessions WHERE activity_id = $1 ORDER BY repeat_no', [id]);
  assert.deepEqual(rows.map((r) => r.start_block_id), [b[2], b[3]]);
  const a = (await pool.query('SELECT status, max_participants FROM activities WHERE id = $1', [id])).rows[0];
  assert.deepEqual(a, { status: 'approvata', max_participants: 12 });
  assert.equal((await pool.query('SELECT count(*)::int n FROM ga_days')).rows[0].n, 1);
  await assert.rejects(approveProposal(pool, id, edit, [b[0], b[1]]), /già decisa/);
});

test('durata lunga: il blocco deve bastare', async () => {
  const id = await propose({ duration: '2', first: String(b[0]), second: String(b[2]) });
  await assert.rejects(approveProposal(pool, id, edit, [b[1]]), /durata/);
  await approveProposal(pool, id, edit, [b[2]]);
  assert.equal((await pool.query('SELECT block_count FROM activity_sessions WHERE activity_id = $1', [id])).rows[0].block_count, 2);
});

test('pagina /approvazione: lista, modifica, approva, rifiuta, materiali CSV, permessi', async () => {
  const a = await propose({ title: 'Yoga' });
  const r = await propose({ title: 'Boxe' });
  let html = await (await fetch(`${base}/approvazione`)).text();
  assert.match(html, /Yoga/);
  assert.match(html, /Blocco 3 · 12:45–14:15 — 2 attività, 22 posti/);
  const fields = { title: 'Yoga Zen', description: 'Calma', phone: '2', materials: 'tappetini', min: '1', max: '8', block1: String(b[1]) };
  assert.match(await (await post(`/approvazione/${a}`, { ...fields, action: 'save' })).text(), /Fatto/);
  assert.equal((await pool.query('SELECT status, title FROM activities WHERE id = $1', [a])).rows[0].title, 'Yoga Zen');
  assert.match(await (await post(`/approvazione/${a}`, { ...fields, action: 'approve' })).text(), /Fatto/);
  assert.equal((await pool.query('SELECT status FROM activities WHERE id = $1', [a])).rows[0].status, 'approvata');
  await post(`/approvazione/${r}`, { action: 'reject', reason: 'Non adatta' });
  const rej = (await pool.query('SELECT status, reject_reason FROM activities WHERE id = $1', [r])).rows[0];
  assert.deepEqual(rej, { status: 'rifiutata', reject_reason: 'Non adatta' });
  html = await (await fetch(`${base}/approvazione`)).text();
  assert.match(html, /Nessuna proposta/);
  assert.match(html, /tappetini/);
  const csv = await (await fetch(`${base}/approvazione/materiali.csv`)).text();
  assert.match(csv, /"Yoga Zen";"Pia Verdi";"tappetini"/);
  assert.match(materialsCsv(await materialsList(pool)), /"'=cmd"/);
  roles = ['allievo'];
  assert.equal((await fetch(`${base}/approvazione`)).status, 403);
  assert.equal((await post(`/approvazione/${a}`, { action: 'reject' })).status, 403);
  roles = ['resp_ga'];
});

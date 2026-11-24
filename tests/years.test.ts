import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let roles: string[] = ['resp_ga'];
let uid: number;
let oldYear: number;
let oldAct: number;
let relId: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const cur = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  oldYear = (await pool.query(`INSERT INTO school_years (name) VALUES ('2025-2026') RETURNING id`)).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('org@x.ch','Ora','Verdi') RETURNING id`)).rows[0].id;
  relId = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('rel@x.ch','Rita','Rossi') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO user_roles VALUES ($1,'relatore')`, [relId]);
  const day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1,'2026-04-21') RETURNING id`, [oldYear])).rows[0].id;
  oldAct = (await pool.query(
    `INSERT INTO activities (school_year_id, title, description, organizer_id, contact, status, min_participants, max_participants, first_block_id, second_block_id, materials)
     VALUES ($1,'Vecchia attivita','Descr vecchia',$2,'091 111','approvata',2,12,$3,$4,'palloni') RETURNING id`, [oldYear, uid, b[0], b[1]])).rows[0].id;
  const a2 = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'Nuova attivita',$2,'approvata',5) RETURNING id`, [cur, uid])).rows[0].id;
  for (const [a, d] of [[oldAct, day]]) await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3)`, [a, d, b[0]]);
  await pool.query(`INSERT INTO year_contacts (school_year_id, user_id) VALUES ($1,$2)`, [oldYear, relId]);
  void a2;
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

test('US-028: i due anni non si mescolano; l\'archivio è solo per i responsabili', async () => {
  roles = ['allievo'];
  const list = await (await fetch(`${base}/attivita`)).text();
  assert.doesNotMatch(list, /Vecchia attivita/);
  assert.equal((await fetch(`${base}/gestione-ga?anno=${oldYear}`)).status, 403);
  for (const r of ['resp_ga', 'resp_sito']) {
    roles = [r];
    const cur = await (await fetch(`${base}/gestione-ga`)).text();
    assert.match(cur, /Nuova attivita/);
    assert.doesNotMatch(cur, /Vecchia attivita/);
    const old = await (await fetch(`${base}/gestione-ga?anno=${oldYear}`)).text();
    assert.match(old, /Archivio 2025-2026 \(sola lettura\)/);
    assert.match(old, /Vecchia attivita/);
    assert.doesNotMatch(old, /Nuova attivita/);
    assert.doesNotMatch(old, /<form/);
  }
});

test('US-029: Riproponi precompila la proposta, l\'originale resta', async () => {
  roles = ['docente'];
  const page = await (await fetch(`${base}/proponi`)).text();
  assert.match(page, new RegExp(`Vecchia attivita \\(2025-2026\\) <a href="/proponi\\?da=${oldAct}">Riproponi`));
  const pre = await (await fetch(`${base}/proponi?da=${oldAct}`)).text();
  assert.match(pre, /value="Vecchia attivita"/);
  assert.match(pre, />Descr vecchia</);
  assert.match(pre, /value="091 111"/);
  const res = await fetch(`${base}/proponi`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: 'Vecchia attivita', description: 'Descr', phone: '1', first: String((await pool.query(`SELECT id FROM time_blocks WHERE kind='blocco' ORDER BY position`)).rows[0].id), second: String((await pool.query(`SELECT id FROM time_blocks WHERE kind='blocco' ORDER BY position`)).rows[1].id), max: '12' }) });
  assert.equal(res.status, 200);
  const rows = (await pool.query(`SELECT school_year_id, status FROM activities WHERE title = 'Vecchia attivita' ORDER BY id`)).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].school_year_id, oldYear);
  assert.equal(rows[0].status, 'approvata');
  assert.equal(rows[1].status, 'proposta');
});

test('US-029: il Responsabile GA ripropone relatori come contatti dell\'anno', async () => {
  roles = ['resp_ga'];
  const page = await (await fetch(`${base}/gestione-ga`)).text();
  assert.match(page, /Rossi Rita \(rel@x\.ch, relatore\)/);
  const r = await fetch(`${base}/gestione-ga/contatti`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `ids=${relId}` });
  assert.match(await r.text(), /1 contatti riproposti/);
  const after = await (await fetch(`${base}/gestione-ga`)).text();
  assert.doesNotMatch(after, /Rossi Rita \(rel@x\.ch, relatore\)/);
  assert.match(after, /Rita Rossi<\/td><td>rel@x\.ch/);
});

test('fix Fase 5: ?anno non valido = 404; contatti solo da anni precedenti; una riga per persona; anni futuri esclusi', async () => {
  roles = ['resp_ga'];
  for (const a of ['abc', '999999', '1.5']) assert.equal((await fetch(`${base}/gestione-ga?anno=${a}`)).status, 404, a);
  const futureYear = (await pool.query(`INSERT INTO school_years (name) VALUES ('2099-2100') RETURNING id`)).rows[0].id;
  const fut = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('fut@x.ch','Fu','Turo') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO user_roles VALUES ($1,'docente')`, [fut]);
  await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'Futura',$2,'approvata',5)`, [futureYear, fut]);
  const multi = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('multi@x.ch','Mu','Lti') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO user_roles VALUES ($1,'docente'), ($1,'relatore')`, [multi]);
  await pool.query(`INSERT INTO year_contacts (school_year_id, user_id) VALUES ($1,$2)`, [oldYear, multi]);
  const page = await (await fetch(`${base}/gestione-ga`)).text();
  assert.equal(page.split('Lti Mu (multi@x.ch').length - 1, 1);
  assert.match(page, /Lti Mu \(multi@x\.ch, docente, relatore\)/);
  assert.doesNotMatch(page, /fut@x\.ch/);
  const post = await fetch(`${base}/gestione-ga/contatti`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `ids=${fut}&ids=${multi}` });
  assert.match(await post.text(), /1 contatti riproposti/); // il futuro è ignorato
  const mine = await (await fetch(`${base}/proponi`)).text();
  roles = ['docente'];
  assert.doesNotMatch(await (await fetch(`${base}/proponi`)).text(), /Futura/);
  void mine;
});

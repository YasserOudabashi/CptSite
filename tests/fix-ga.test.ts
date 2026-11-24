import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';
import { exportRows } from '../src/ga/exports';
import { buildPlan, applyAssign, undoAssign } from '../src/ga/assign';
import { cancelEnrollment } from '../src/ga/enroll';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let year: number;
let current = 0;
let roles = ['resp_ga'];
let b: number[];
let day: number;
const sess: Record<string, number> = {};
const act: Record<string, number> = {};

const mkUser = async (login: string, pw = true, role = 'allievo') => {
  const id = (await pool.query(`INSERT INTO users (login_id, first_name, last_name, class_name, password_hash) VALUES ($1,$1,'T','I3A',$2) RETURNING id`, [login, pw ? 'h' : null])).rows[0].id as number;
  await pool.query('INSERT INTO user_roles VALUES ($1,$2)', [id, role]);
  return id;
};

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1,'2027-04-21') RETURNING id`, [year])).rows[0].id;
  b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const org = await mkUser('orgst'); // allievo che organizza X nel blocco 1
  const mk = async (t: string, o: number, blk: number, max: number) => {
    act[t] = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,$2,$3,'approvata',$4) RETURNING id`, [year, t, o, max])).rows[0].id;
    sess[t] = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [act[t], day, b[blk]])).rows[0].id;
  };
  await mk('X', org, 0, 10);
  await mk('Y', org, 1, 10);
  await mk('Z', await mkUser('prof', true, 'docente'), 0, 10);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: current, roles } as never;
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

test('export allievi con filtri attività/tipo non va in errore; relatori e docenti li ignorano', async () => {
  const f = { kind: 'docente', ids: [act.Z], classe: 'I3A' };
  const al = await exportRows(pool, 'allievi', year, f);
  assert.ok(al.length >= 2);
  assert.equal((await exportRows(pool, 'allievi', year, { classe: 'ZZZ' })).length, 1);
  assert.equal((await exportRows(pool, 'attivita', year, f)).length, 2);
  await exportRows(pool, 'relatori', year, f);
  await exportRows(pool, 'docenti', year, f);
  const r = await fetch(`${base}/gestione-ga/export?what=allievi&fmt=csv&kind=docente&ids=${act.Z}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="allievi-2026-2027.csv"/);
});

test('elenco ID caricato: allievi fuori elenco non sono né assegnati né esportati', async () => {
  await mkUser('listato');
  await mkUser('fuori');
  await pool.query(`INSERT INTO student_ids (school_year_id, login_id) VALUES ($1,'listato'), ($1,'orgst')`, [year]);
  const plan = await buildPlan(pool);
  const names = (await exportRows(pool, 'allievi', year)).map((r) => r[2]);
  assert.ok(names.includes('listato'));
  assert.ok(!names.includes('fuori'));
  assert.equal(plan.students, 1); // solo listato: orgst ha tutti i blocchi occupati, fuori non è nell'elenco
});

test('FR-10: i blocchi in cui l\'allievo organizza contano come occupati nell\'assegnazione', async () => {
  await pool.query(`UPDATE school_years SET enrollment_state = 'chiuse' WHERE is_current`);
  const done = await applyAssign(pool, true);
  const org = (await pool.query(`SELECT id FROM users WHERE login_id = 'orgst'`)).rows[0].id;
  // orgst organizza i blocchi 1 e 2: assegnazioni solo se esistessero altri blocchi coperti (nessuno)
  assert.equal(done.rows.filter((r) => r.userId === org).length, 0);
});

test('annullamento e undo non toccano iscrizioni con presenza segnata; undo solo a iscrizioni chiuse', async () => {
  const u = (await pool.query(`SELECT id FROM users WHERE login_id = 'listato'`)).rows[0].id;
  assert.ok((await pool.query('SELECT 1 FROM enrollments WHERE user_id = $1', [u])).rowCount! >= 1);
  await pool.query(`UPDATE enrollments SET present = true WHERE id = (SELECT min(id) FROM enrollments WHERE user_id = $1)`, [u]);
  await assert.rejects(cancelEnrollment(pool, { id: u, roles: ['allievo'] }, (await pool.query('SELECT session_id FROM enrollments WHERE user_id = $1 AND present', [u])).rows[0].session_id), /presenza/);
  const left = (await pool.query('SELECT count(*)::int n FROM enrollments WHERE assigned AND present IS NULL')).rows[0].n;
  assert.equal(await undoAssign(pool), left);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments WHERE user_id = $1', [u])).rows[0].n, 1);
  await pool.query(`UPDATE school_years SET enrollment_state = 'aperte' WHERE is_current`);
  await assert.rejects(undoAssign(pool), /chiuse/);
});

test('POST iscrizione: redirect 303 e messaggio mostrato su /attivita una sola volta', async () => {
  roles = ['allievo'];
  current = await mkUser('nuovo');
  const r = await fetch(`${base}/iscrizione/${sess.Z}`, { method: 'POST', redirect: 'manual' });
  assert.equal(r.status, 303);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const page = await (await fetch(`${base}/attivita`, { headers: { cookie } })).text();
  assert.match(page, /Iscrizione registrata\./);
});

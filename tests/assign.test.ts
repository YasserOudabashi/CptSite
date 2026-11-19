import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { applyAssign, buildPlan, undoAssign } from '../src/ga/assign';

let pool: Pool;
let stopDb: () => Promise<void>;
let n = 0;
let year: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const org = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('org','O','O') RETURNING id`)).rows[0].id;
  for (const [t, blk, max] of [['X', 0, 4], ['Y', 0, 4], ['Z', 1, 4], ['W', 1, 3]] as const) {
    const a = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,$2,$3,'approvata',$4) RETURNING id`, [year, t, org, max])).rows[0].id;
    await pool.query('INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3)', [a, day, b[blk]]);
  }
  await pool.query('INSERT INTO student_ids (school_year_id, login_id) VALUES ($1,$2), ($1,$3)', [year, 'reg0', 'mai-registrato']);
});
after(async () => stopDb());

async function students(count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = (await pool.query(`INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ($1,'S',$2,'h') RETURNING id`, [`reg${n}`, `S${n}`])).rows[0].id;
    n++;
    await pool.query(`INSERT INTO user_roles VALUES ($1,'allievo')`, [id]);
    ids.push(id);
  }
  return ids;
}

// nessun superamento dei massimi, nessun doppio impegno (garantito anche dall'unicità nel database)
async function check() {
  const over = await pool.query(
    `SELECT s.id FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
     WHERE (SELECT count(*) FROM enrollments e WHERE e.session_id = s.id) > a.max_participants`);
  assert.equal(over.rowCount, 0);
  const dup = await pool.query('SELECT user_id, block_id FROM enrollment_blocks GROUP BY user_id, block_id HAVING count(*) > 1');
  assert.equal(dup.rowCount, 0);
}

test('assegna solo a iscrizioni chiuse', async () => {
  await students(7);
  await pool.query(`UPDATE school_years SET enrollment_state = 'aperte' WHERE is_current`);
  await assert.rejects(applyAssign(pool, false), /chiuse/);
  await pool.query(`UPDATE school_years SET enrollment_state = 'chiuse' WHERE is_current`);
});

test('7 allievi, 8 posti per blocco: tutti assegnati, iscrizioni manuali intatte, non registrati segnalati', async () => {
  const [first] = (await pool.query(`SELECT id FROM users WHERE login_id = 'reg0'`)).rows.map((r) => r.id);
  const x = (await pool.query(`SELECT s.id FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title = 'X'`)).rows[0].id;
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [first, x]);
  const prev = await buildPlan(pool);
  assert.equal(prev.students, 7);
  assert.equal(prev.slots, 13); // 7*2 - 1 già iscritto
  assert.equal(prev.freeSeats, 14); // 4+4+4+3 meno 1
  assert.deepEqual(prev.notRegistered, ['mai-registrato']); // reg0 è registrato
  assert.equal(prev.unassignable.length, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments WHERE assigned')).rows[0].n, 0); // l'anteprima non scrive
  const done = await applyAssign(pool, false);
  assert.equal(done.rows.length, 13);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollment_blocks')).rows[0].n, 14);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments WHERE assigned')).rows[0].n, 13);
  await check();
});

test('annullabili in blocco: restano le iscrizioni manuali', async () => {
  assert.equal(await undoAssign(pool), 13);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments')).rows[0].n, 1);
});

test('posti insufficienti: elenco dei non assegnabili, niente parziale senza conferma', async () => {
  await students(5); // 12 allievi, 8 posti per blocco
  const plan = await buildPlan(pool);
  assert.ok(plan.unassignable.length >= 7);
  await assert.rejects(applyAssign(pool, false), /non assegnabili/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments WHERE assigned')).rows[0].n, 0);
  const done = await applyAssign(pool, true);
  assert.ok(done.unassignable.length >= 7);
  await check();
  // tutti i posti sono pieni
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollments')).rows[0].n, 15);
});

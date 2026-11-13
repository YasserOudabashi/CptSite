import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';

let pool: Pool;
let stopDb: () => Promise<void>;
let yearId: number;
let dayId: number;
let blocks: number[];

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  yearId = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  dayId = (await pool.query('INSERT INTO ga_days (school_year_id, day) VALUES ($1, $2) RETURNING id', [yearId, '2027-05-12'])).rows[0].id;
  blocks = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
});
after(async () => {
  await stopDb();
});

async function user(login: string): Promise<number> {
  return (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1, 'A', 'B') RETURNING id`, [login])).rows[0].id;
}
async function activity(org: number, max = 10): Promise<number> {
  return (await pool.query(
    `INSERT INTO activities (school_year_id, title, organizer_id, max_participants) VALUES ($1, 'T', $2, $3) RETURNING id`,
    [yearId, org, max],
  )).rows[0].id;
}
async function session(act: number, rep: number, start: number, count = 1): Promise<number> {
  return (await pool.query(
    `INSERT INTO activity_sessions (activity_id, repeat_no, ga_day_id, start_block_id, block_count) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [act, rep, dayId, start, count],
  )).rows[0].id;
}
const enroll = (u: number, s: number) => pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1, $2)', [u, s]);

test('iscrizione: anno e attività riempiti dal trigger', async () => {
  const org = await user('o1@x.ch');
  const u = await user('u1@x.ch');
  const a = await activity(org);
  const s = await session(a, 1, blocks[0]);
  await enroll(u, s);
  const { rows } = await pool.query('SELECT school_year_id, activity_id FROM enrollments WHERE user_id = $1', [u]);
  assert.deepEqual(rows[0], { school_year_id: yearId, activity_id: a });
});

test('un utente non può avere due iscrizioni nello stesso blocco, anche con sessioni lunghe', async () => {
  const org = await user('o2@x.ch');
  const u = await user('u2@x.ch');
  const lunga = await session(await activity(org), 1, blocks[0], 2); // blocchi 1 e 2
  const b2 = await session(await activity(org), 1, blocks[1]);
  const b3 = await session(await activity(org), 1, blocks[2]);
  await enroll(u, lunga);
  await assert.rejects(enroll(u, b2), /enrollment_blocks/);
  await enroll(u, b3);
  assert.equal((await pool.query('SELECT count(*)::int n FROM enrollment_blocks WHERE user_id = $1', [u])).rows[0].n, 3);
  // la disdetta libera i blocchi
  await pool.query('DELETE FROM enrollments WHERE user_id = $1 AND session_id = $2', [u, lunga]);
  await enroll(u, b2);
});

test('una sola sessione per attività ripetuta', async () => {
  const org = await user('o3@x.ch');
  const u = await user('u3@x.ch');
  const a = await activity(org);
  const s1 = await session(a, 1, blocks[0]);
  const s2 = await session(a, 2, blocks[2]);
  await enroll(u, s1);
  await assert.rejects(enroll(u, s2), /duplicate key|unique/i);
});

test('vincoli: min <= max, prima e seconda scelta diverse, ripetizioni 1 o 2', async () => {
  const org = await user('o4@x.ch');
  const ins = (extra: string) =>
    pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, max_participants, ${extra.split('=')[0]}) VALUES ($1,'T',$2,5,${extra.split('=')[1]})`, [yearId, org]);
  await assert.rejects(ins('min_participants=9'));
  await assert.rejects(ins('repetitions=3'));
  await assert.rejects(
    pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, max_participants, first_block_id, second_block_id) VALUES ($1,'T',$2,5,$3,$3)`, [yearId, org, blocks[0]]),
  );
});

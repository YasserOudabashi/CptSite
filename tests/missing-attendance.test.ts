import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { missingAttendance } from '../src/ga/manage';

let pool: Pool;
let stopDb: () => Promise<void>;
let sessions: Record<string, number> = {};

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1,'2027-04-21') RETURNING id`, [year])).rows[0].id;
  const undated = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const org = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('o@x.ch','Olga','Org') RETURNING id`)).rows[0].id;
  const st = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('s@x.ch','S','S') RETURNING id`)).rows[0].id;
  const mk = async (t: string, d: number, blk: number, enrolled: boolean, present: boolean | null) => {
    const a = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, contact, status, max_participants) VALUES ($1,$2,$3,'091 1',$4,5) RETURNING id`, [year, t, org, 'approvata'])).rows[0].id;
    const s = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [a, d, b[blk]])).rows[0].id;
    sessions[t] = s;
    if (enrolled) await pool.query('INSERT INTO enrollments (user_id, session_id, present) VALUES ($1,$2,$3)', [st, s, present]);
  };
  await mk('Mancante', day, 0, true, null);
  await mk('Segnata', day, 1, true, true);
  await mk('Vuota', day, 2, false, null);
  await mk('SenzaData', undated, 0, true, null);
});
after(async () => stopDb());

test('dopo la fine: solo le attività senza presenze, con organizzatore e contatto', async () => {
  const m = await missingAttendance(pool, new Date('2027-04-21T18:00:00+02:00'));
  assert.deepEqual(m.map((x) => x.title), ['Mancante']);
  assert.equal(m[0].organizer, 'Olga Org');
  assert.equal(m[0].email, 'o@x.ch');
  assert.equal(m[0].phone, '091 1');
});

test('prima della fine del blocco non compare', async () => {
  assert.equal((await missingAttendance(pool, new Date('2027-04-21T09:30:00+02:00'))).length, 0); // blocco 1 finisce alle 10:00
  assert.equal((await missingAttendance(pool, new Date('2027-04-21T10:30:00+02:00'))).length, 1);
});

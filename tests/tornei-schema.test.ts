import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';

let pool: Pool;
let stopDb: () => Promise<void>;
let t: number;
let u1: number;
let u2: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  u1 = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('a@x.ch','A','B') RETURNING id`)).rows[0].id;
  u2 = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('b@x.ch','C','D') RETURNING id`)).rows[0].id;
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  t = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport) VALUES ($1,$2,'T','Calcio') RETURNING id`, [y, u1])).rows[0].id;
});
after(async () => stopDb());

test('US-031: ruolo resp_tornei, stati e default del torneo', async () => {
  assert.equal((await pool.query(`SELECT 1 FROM roles WHERE code = 'resp_tornei'`)).rowCount, 1);
  const r = (await pool.query('SELECT status, mode, pts_win, pts_draw, pts_loss, score_type FROM tournaments WHERE id = $1', [t])).rows[0];
  assert.deepEqual(r, { status: 'bozza', mode: 'squadre', pts_win: 3, pts_draw: 1, pts_loss: 0, score_type: 'punti' });
  await assert.rejects(pool.query(`UPDATE tournaments SET status = 'boh' WHERE id = $1`, [t]));
});

test('US-031: un utente è in una sola squadra per torneo, in tornei diversi sì', async () => {
  const team = async (tid: number, n: string) => (await pool.query(`INSERT INTO tournament_teams (tournament_id, name) VALUES ($1,$2) RETURNING id`, [tid, n])).rows[0].id;
  const a = await team(t, 'Alfa');
  const b = await team(t, 'Beta');
  await assert.rejects(pool.query(`INSERT INTO tournament_teams (tournament_id, name) VALUES ($1,'alfa')`, [t]));
  await pool.query(`INSERT INTO tournament_members (team_id, tournament_id, user_id) VALUES ($1,$2,$3)`, [a, t, u1]);
  await assert.rejects(pool.query(`INSERT INTO tournament_members (team_id, tournament_id, user_id) VALUES ($1,$2,$3)`, [b, t, u1]));
  await pool.query(`INSERT INTO tournament_members (team_id, tournament_id, user_id) VALUES ($1,$2,$3)`, [b, t, u2]);
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const t2 = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport) VALUES ($1,$2,'T2','Ping-pong') RETURNING id`, [y, u1])).rows[0].id;
  const c = await team(t2, 'Alfa');
  await pool.query(`INSERT INTO tournament_members (team_id, tournament_id, user_id) VALUES ($1,$2,$3)`, [c, t2, u1]);
});

test('US-031: partite, risultato e anno', async () => {
  const [a, b] = (await pool.query('SELECT id FROM tournament_teams WHERE tournament_id = $1 ORDER BY id', [t])).rows.map((r) => r.id);
  await pool.query(`INSERT INTO tournament_matches (tournament_id, stage, round, pos, home_id, away_id) VALUES ($1,'girone',1,1,$2,$3)`, [t, a, b]);
  assert.equal((await pool.query(`SELECT status FROM tournament_matches`)).rows[0].status, 'da giocare');
  await assert.rejects(pool.query(`INSERT INTO tournaments (created_by, name, sport) VALUES ($1,'X','Y')`, [u1]));
});

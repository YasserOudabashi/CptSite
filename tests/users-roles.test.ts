import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { seed } from '../src/db/seed';
import { assignRole, getUserRoles, getCurrentSchoolYear } from '../src/users/roles';

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

test('ruoli iniziali presenti', async () => {
  const { rows } = await pool.query('SELECT code FROM roles ORDER BY code');
  assert.deepEqual(
    rows.map((r: { code: string }) => r.code),
    ['allievo', 'docente', 'relatore', 'resp_ga', 'resp_sito'],
  );
});

test('esattamente un anno corrente: 2026-2027', async () => {
  const year = await getCurrentSchoolYear(pool);
  assert.equal(year.name, '2026-2027');
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM school_years WHERE is_current');
  assert.equal(rows[0].n, 1);
});

test('il database rifiuta un secondo anno corrente', async () => {
  await assert.rejects(
    pool.query(`INSERT INTO school_years (name, is_current) VALUES ('2027-2028', true)`),
  );
});

test('seed crea un solo Responsabile sito, anche se rilanciato', async () => {
  await seed(pool);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM user_roles WHERE role_code = 'resp_sito'`,
  );
  assert.equal(rows[0].n, 1);
});

test('due ruoli assegnati allo stesso utente vengono entrambi restituiti', async () => {
  const { rows } = await pool.query(
    `INSERT INTO users (login_id, first_name, last_name, class_name)
     VALUES ('abc123@studenti.edu.ti.ch', 'Mario', 'Rossi', 'I3A') RETURNING id`,
  );
  const userId: number = rows[0].id;
  await assignRole(pool, userId, 'allievo');
  await assignRole(pool, userId, 'resp_ga');
  await assignRole(pool, userId, 'allievo'); // doppione ignorato
  assert.deepEqual(await getUserRoles(pool, userId), ['allievo', 'resp_ga']);
});

test('login_id unico senza distinzione maiuscole/minuscole', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO users (login_id, first_name, last_name) VALUES ('ABC123@studenti.edu.ti.ch', 'X', 'Y')`,
    ),
  );
});

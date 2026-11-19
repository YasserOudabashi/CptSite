import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Pool } from 'pg';
import express from 'express';
import { homeRouter } from '../src/ui/home';
import { createTestDb } from './helpers/db';

let stopDb: () => Promise<void>;
let pool: Pool;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

before(async () => {
  const db = await createTestDb();
  stopDb = db.stop;
  pool = db.pool;

  const app = express();
  app.use(homeRouter(pool));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await stopDb();
});

test('GET / risponde 200', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
});

test('schema_migrations esiste nel database di test', async () => {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
  );
  assert.equal(rows.length, 1);
});

test('migrazione 001_init.sql è applicata', async () => {
  const { rows } = await pool.query(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  assert.ok(
    rows.some((r: { filename: string }) => r.filename === '001_init.sql'),
    'La migrazione 001_init.sql non è registrata',
  );
});

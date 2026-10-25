import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import net from 'net';
import os from 'os';
import path from 'path';
import { runMigrations } from '../../src/db/migrate';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Impossibile ottenere una porta libera'));
        return;
      }
      const { port } = addr;
      server.close(() => resolve(port));
    });
  });
}

export interface TestDb {
  pool: Pool;
  stop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const port = await getFreePort();
  const databaseDir = path.join(os.tmpdir(), `pgtest-${Date.now()}-${port}`);

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'testuser',
    password: 'testpass',
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('testdb');

  const connectionString = `postgresql://testuser:testpass@localhost:${port}/testdb`;
  process.env.TEST_DATABASE_URL = connectionString;

  const pool = new Pool({ connectionString });
  await runMigrations(pool);

  return {
    pool,
    stop: async () => {
      await pool.end();
      await pg.stop();
    },
  };
}

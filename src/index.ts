import { Pool } from 'pg';
import { app } from './app';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';

const PORT = process.env.PORT ?? '3000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function start() {
  await runMigrations(pool);
  await seed(pool);
  app.listen(Number(PORT), () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Errore avvio:', err);
  process.exit(1);
});

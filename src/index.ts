import { Pool } from 'pg';
import { app } from './app';
import { adminRouter } from './admin/router';
import { authRouter } from './auth/router';
import { sessionMiddleware } from './auth/session';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';
import { homeRouter } from './ui/home';
import { layoutMiddleware } from './ui/layout';
import { processMailQueue, startMailWorker } from './mail/queue';

const PORT = process.env.PORT ?? '3000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function start() {
  await runMigrations(pool);
  await seed(pool);
  // Coda mail a lotti: riprende all'avvio e poi ogni 10 minuti (anche il giorno dopo il limite).
  processMailQueue(pool).catch((err) => console.error('Coda mail:', err));
  startMailWorker(pool);
  app.use(sessionMiddleware(pool));
  app.use(layoutMiddleware(pool));
  app.use(homeRouter());
  app.use(authRouter(pool));
  app.use(adminRouter(pool));
  app.listen(Number(PORT), () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Errore avvio:', err);
  process.exit(1);
});

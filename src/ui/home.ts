import { Router } from 'express';
import { Pool } from 'pg';
import { STATES, getEnrollState } from '../ga/enroll';

export function homeRouter(pool: Pool): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => {
    try {
      const state = await getEnrollState(pool);
      res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Home</title></head><body>
<h1>Home</h1>
<p>Benvenuto nel portale delle Giornate Autogestite del CPT Trevano.</p>
<p>Iscrizioni alle GA: <strong>${STATES[state]}</strong></p>
</body></html>`);
    } catch (e) {
      next(e);
    }
  });
  return router;
}

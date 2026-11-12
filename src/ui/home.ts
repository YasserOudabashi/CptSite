import { Router } from 'express';

export function homeRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Home</title></head><body>
<h1>Home</h1>
<p>Benvenuto nel portale delle Giornate Autogestite del CPT Trevano.</p>
</body></html>`);
  });
  return router;
}

import express from 'express';

export const app = express();
// Dietro il reverse proxy req.ip deve essere quello dell'utente, non del proxy.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CSRF: le richieste che modificano (non GET/HEAD/OPTIONS) devono arrivare dal nostro sito: Origin (o Referer se manca) = SITE_URL.
// SITE_URL è obbligatoria in produzione (controllo all'avvio). Senza Origin né Referer si rifiuta solo in produzione.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !process.env.SITE_URL) return next();
  const from = req.get('origin') ?? req.get('referer');
  let ok = false;
  try {
    ok = from ? new URL(from).origin === new URL(process.env.SITE_URL).origin : process.env.NODE_ENV !== 'production';
  } catch {
    /* URL non valido: rifiutata */
  }
  if (!ok) {
    res.status(403).send('Richiesta non valida (origine non consentita).');
    return;
  }
  next();
});

import { Router } from 'express';
import { Pool } from 'pg';
import { startRegistration, StartResult } from './registration';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const MESSAGES: Record<Exclude<StartResult, { ok: true }>['reason'], string> = {
  rate_limited: 'Troppi tentativi. Riprova tra un’ora.',
  invalid: 'ID o codice generale non validi.',
  exists: 'Account già esistente: usa il recupero password.',
  mail_failed: 'Non siamo riusciti a inviare la mail. Riprova più tardi.',
  missing_fields: 'Compila tutti i campi.',
};

function page(flash = '', values: Record<string, string> = {}): string {
  const v = (k: string) => esc(values[k] ?? '');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Registrazione</title></head><body>
<h1>Registrazione allievi</h1>
${flash}
<form method="post" action="/registrazione">
<p><label>ID (es. abc123@studenti.edu.ti.ch)<br><input name="loginId" value="${v('loginId')}" required autocomplete="username"></label></p>
<p><label>Codice generale<br><input name="generalCode" required autocomplete="off"></label></p>
<p><label>Nome<br><input name="firstName" value="${v('firstName')}" required></label></p>
<p><label>Cognome<br><input name="lastName" value="${v('lastName')}" required></label></p>
<p><label>Classe<br><input name="className" value="${v('className')}" required></label></p>
<p><button>Ricevi il codice personale</button></p></form>
</body></html>`;
}

export function authRouter(pool: Pool): Router {
  const router = Router();

  router.get('/registrazione', (_req, res) => {
    res.send(page());
  });

  router.post('/registrazione', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      const values = {
        loginId: String(b.loginId ?? ''),
        firstName: String(b.firstName ?? ''),
        lastName: String(b.lastName ?? ''),
        className: String(b.className ?? ''),
      };
      const r = await startRegistration(pool, {
        ...values,
        generalCode: String(b.generalCode ?? ''),
        ip: req.ip ?? 'unknown',
      });
      if (r.ok) {
        res.send(
          `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Registrazione</title></head><body>
<h1>Controlla la tua mail</h1><p>Ti abbiamo inviato un codice personale, valido 24 ore.</p></body></html>`,
        );
        return;
      }
      res.status(r.reason === 'rate_limited' ? 429 : 400).send(
        page(`<p><strong>${MESSAGES[r.reason]}</strong></p>`, values),
      );
    } catch (e) {
      next(e);
    }
  });

  return router;
}

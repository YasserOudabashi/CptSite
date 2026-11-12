import { Router } from 'express';
import { Pool } from 'pg';
import { login, logout, readCookie, COOKIE, sessionCookie } from './session';
import { completePasswordReset, requestPasswordReset, ResetResult } from './passwordReset';
import { acceptInvite, findValidInvite } from '../admin/invites';
import { completeRegistration, CompleteResult, startRegistration, StartResult } from './registration';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const MESSAGES: Record<Exclude<StartResult, { ok: true }>['reason'], string> = {
  rate_limited: 'Troppi tentativi. Riprova tra un’ora.',
  invalid: 'ID o codice generale non validi.',
  exists: 'Account già esistente: usa il recupero password.',
  mail_failed: 'Non siamo riusciti a inviare la mail. Riprova più tardi.',
  missing_fields: 'Compila tutti i campi.',
};

const CODE_MESSAGES: Record<Exclude<CompleteResult, { ok: true }>['reason'], string> = {
  rate_limited: 'Troppi tentativi. Riprova tra un’ora.',
  bad_code: 'Codice non valido o scaduto. <a href="/registrazione">Richiedi un nuovo codice</a>.',
  password_short: 'La password deve avere almeno 10 caratteri.',
  password_mismatch: 'Le due password non coincidono.',
};

function codePage(flash = '', loginId = ''): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Scegli la password</title></head><body>
<h1>Scegli la password</h1>
${flash}
<form method="post" action="/registrazione/codice">
<p><label>ID<br><input name="loginId" value="${esc(loginId)}" required autocomplete="username"></label></p>
<p><label>Codice personale (ricevuto per mail)<br><input name="code" required autocomplete="one-time-code"></label></p>
<p><label>Password (almeno 10 caratteri)<br><input type="password" name="password" required minlength="10" autocomplete="new-password"></label></p>
<p><label>Ripeti la password<br><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label></p>
<p><button>Attiva l’account</button></p></form>
<p><a href="/registrazione">Non hai il codice? Richiedine uno nuovo</a></p>
</body></html>`;
}

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

  const loginPage = (flash = '', loginId = '') => `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Accedi</title></head><body>
<h1>Accedi</h1>
${flash}
<form method="post" action="/login">
<p><label>ID<br><input name="loginId" value="${esc(loginId)}" required autocomplete="username"></label></p>
<p><label>Password<br><input type="password" name="password" required autocomplete="current-password"></label></p>
<p><button>Accedi</button></p></form>
<p><a href="/registrazione">Registrati</a> · <a href="/recupero-password">Password dimenticata?</a></p>
</body></html>`;

  router.get('/login', (_req, res) => {
    res.send(loginPage());
  });

  router.post('/login', async (req, res, next) => {
    try {
      const loginId = String(req.body?.loginId ?? '');
      const r = await login(pool, loginId, String(req.body?.password ?? ''));
      if (r.ok) {
        res.setHeader('Set-Cookie', sessionCookie(r.token));
        res.redirect(303, '/');
        return;
      }
      const msg = r.reason === 'locked' ? 'Troppi tentativi falliti. Riprova tra 15 minuti.' : 'ID o password non validi.';
      res.status(r.reason === 'locked' ? 429 : 401).send(loginPage(`<p><strong>${msg}</strong></p>`, loginId));
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE);
      if (token) await logout(pool, token);
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      res.redirect(303, '/login');
    } catch (e) {
      next(e);
    }
  });

  const shell = (title: string, body: string) => `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body>
<h1>${title}</h1>
${body}
</body></html>`;

  const resetRequestPage = (flash = '', loginId = '') =>
    shell(
      'Recupero password',
      `${flash}<form method="post" action="/recupero-password">
<p><label>ID<br><input name="loginId" value="${esc(loginId)}" required autocomplete="username"></label></p>
<p><button>Ricevi il codice</button></p></form>
<p><a href="/login">Torna all’accesso</a></p>`,
    );

  const resetCodePage = (flash = '', loginId = '') =>
    shell(
      'Scegli la nuova password',
      `${flash}<form method="post" action="/recupero-password/codice">
<p><label>ID<br><input name="loginId" value="${esc(loginId)}" required autocomplete="username"></label></p>
<p><label>Codice ricevuto per mail<br><input name="code" required autocomplete="one-time-code"></label></p>
<p><label>Nuova password (almeno 10 caratteri)<br><input type="password" name="password" required minlength="10" autocomplete="new-password"></label></p>
<p><label>Ripeti la password<br><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label></p>
<p><button>Cambia password</button></p></form>`,
    );

  const RESET_MESSAGES: Record<Exclude<ResetResult, { ok: true }>['reason'], string> = {
    rate_limited: 'Troppi tentativi. Riprova tra un’ora.',
    bad_code: 'Codice non valido o scaduto. <a href="/recupero-password">Richiedi un nuovo codice</a>.',
    password_short: 'La password deve avere almeno 10 caratteri.',
    password_mismatch: 'Le due password non coincidono.',
  };

  router.get('/recupero-password', (_req, res) => {
    res.send(resetRequestPage());
  });

  router.post('/recupero-password', async (req, res, next) => {
    try {
      const loginId = String(req.body?.loginId ?? '');
      const r = await requestPasswordReset(pool, loginId, req.ip ?? 'unknown');
      if (r.ok) {
        res.send(
          shell(
            'Controlla la tua mail',
            `<p>Se l’ID esiste, ti abbiamo inviato un codice valido 30 minuti.</p>
<p><a href="/recupero-password/codice">Inserisci il codice e scegli la nuova password</a></p>`,
          ),
        );
        return;
      }
      const msg =
        r.reason === 'rate_limited'
          ? 'Troppi tentativi. Riprova tra un’ora.'
          : 'Non siamo riusciti a inviare la mail. Riprova più tardi.';
      res.status(r.reason === 'rate_limited' ? 429 : 500).send(resetRequestPage(`<p><strong>${msg}</strong></p>`, loginId));
    } catch (e) {
      next(e);
    }
  });

  router.get('/recupero-password/codice', (_req, res) => {
    res.send(resetCodePage());
  });

  router.post('/recupero-password/codice', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      const loginId = String(b.loginId ?? '');
      const r = await completePasswordReset(pool, {
        loginId,
        code: String(b.code ?? ''),
        password: String(b.password ?? ''),
        password2: String(b.password2 ?? ''),
      });
      if (r.ok) {
        res.send(shell('Password cambiata', '<p>Ora puoi <a href="/login">accedere</a> con la nuova password.</p>'));
        return;
      }
      res.status(r.reason === 'rate_limited' ? 429 : 400).send(
        resetCodePage(`<p><strong>${RESET_MESSAGES[r.reason]}</strong></p>`, loginId),
      );
    } catch (e) {
      next(e);
    }
  });

  const INVITE_BAD =
    '<p>Questo invito non è valido: è scaduto o è già stato usato. Chiedi un nuovo invito al Responsabile del sito.</p>';
  const INVITE_MESSAGES = {
    password_short: 'La password deve avere almeno 10 caratteri.',
    password_mismatch: 'Le due password non coincidono.',
    exists: 'Esiste già un account con questo indirizzo: usa il recupero password.',
  } as const;

  const invitePage = (token: string, inv: { first_name: string; last_name: string; email: string; role_code: string }, flash = '') =>
    shell(
      'Registrazione su invito',
      `${flash}<p>${esc(inv.first_name)} ${esc(inv.last_name)} · ${inv.role_code === 'docente' ? 'Docente' : 'Relatore'}<br>ID: <strong>${esc(inv.email)}</strong></p>
<form method="post" action="/invito/${encodeURIComponent(token)}">
<p><label>Password (almeno 10 caratteri)<br><input type="password" name="password" required minlength="10" autocomplete="new-password"></label></p>
<p><label>Ripeti la password<br><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label></p>
<p><button>Attiva l’account</button></p></form>`,
    );

  router.get('/invito/:token', async (req, res, next) => {
    try {
      const inv = await findValidInvite(pool, req.params.token);
      if (!inv) {
        res.status(410).send(shell('Invito non valido', INVITE_BAD));
        return;
      }
      res.send(invitePage(req.params.token, inv));
    } catch (e) {
      next(e);
    }
  });

  router.post('/invito/:token', async (req, res, next) => {
    try {
      const token = req.params.token;
      const inv = await findValidInvite(pool, token);
      if (!inv) {
        res.status(410).send(shell('Invito non valido', INVITE_BAD));
        return;
      }
      const r = await acceptInvite(pool, token, String(req.body?.password ?? ''), String(req.body?.password2 ?? ''));
      if (r.ok) {
        res.send(shell('Account attivato', '<p>Ora puoi <a href="/login">accedere</a> con la tua e-mail e la password scelta.</p>'));
      } else if (r.reason === 'invalid') {
        res.status(410).send(shell('Invito non valido', INVITE_BAD));
      } else {
        res.status(400).send(invitePage(token, inv, `<p><strong>${INVITE_MESSAGES[r.reason]}</strong></p>`));
      }
    } catch (e) {
      next(e);
    }
  });

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
<h1>Controlla la tua mail</h1><p>Ti abbiamo inviato un codice personale, valido 24 ore.</p>
<p><a href="/registrazione/codice">Inserisci il codice e scegli la password</a></p></body></html>`,
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

  router.get('/registrazione/codice', (_req, res) => {
    res.send(codePage());
  });

  router.post('/registrazione/codice', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      const loginId = String(b.loginId ?? '');
      const r = await completeRegistration(pool, {
        loginId,
        code: String(b.code ?? ''),
        password: String(b.password ?? ''),
        password2: String(b.password2 ?? ''),
      });
      if (r.ok) {
        res.send(
          `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Registrazione</title></head><body>
<h1>Account attivato</h1><p>Ora puoi accedere con il tuo ID e la password scelta.</p></body></html>`,
        );
        return;
      }
      res.status(r.reason === 'rate_limited' ? 429 : 400).send(
        codePage(`<p><strong>${CODE_MESSAGES[r.reason]}</strong></p>`, loginId),
      );
    } catch (e) {
      next(e);
    }
  });

  return router;
}

import { Router } from 'express';
import { Pool } from 'pg';
import { requireCan } from '../auth/permissions';
import {
  countStudentIds,
  hasGeneralCode,
  importStudentIds,
  schoolDomain,
  setGeneralCode,
} from './studentList';
import { INVITE_ROLES, createInvite, listInvites } from './invites';
import {
  addGaDay,
  createSchoolYear,
  gaDatesLabel,
  listBlocks,
  listGaDays,
  listSchoolYears,
  qrPng,
  removeGaDay,
  setCurrentSchoolYear,
  updateBlock,
} from './settings';
import { ROLE_CODES, addUserRole, dropUserRole, searchUsers } from './users';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function page(pool: Pool, flash = ''): Promise<string> {
  const n = await countStudentIds(pool);
  const code = await hasGeneralCode(pool);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Elenco ID e codice generale</title></head><body>
<h1>Elenco ID allievi e codice generale</h1>
${flash}
<h2>Elenco ID (facoltativo)</h2>
<p>${n === 0 ? `Nessun elenco caricato: può registrarsi qualunque indirizzo @${esc(schoolDomain())} che conosce il codice generale.` : `ID caricati per l'anno corrente: <strong>${n}</strong>. Si possono registrare solo questi.`}</p>
<form method="post" action="/admin/studenti">
<p>Una riga per ID, es. <code>ssl586@${esc(schoolDomain())}</code>. Si può aggiungere in qualunque momento.</p>
<p><input type="file" id="file" accept=".csv,.txt"></p>
<p><textarea name="csv" id="csv" rows="10" cols="50"></textarea></p>
<p><button>Carica elenco</button></p></form>
<script>document.getElementById('file').addEventListener('change',function(e){var f=e.target.files[0];if(f)f.text().then(function(t){document.getElementById('csv').value=t;});});</script>
<h2>Codice generale</h2>
<p>${code ? 'Codice impostato.' : 'Codice non ancora impostato: nessuno può registrarsi.'}</p>
<form method="post" action="/admin/codice-generale">
<p><label>Nuovo codice <input type="text" name="code" required minlength="4" autocomplete="off"></label> <button>Salva</button></p></form>
</body></html>`;
}

const ROLE_LABEL: Record<string, string> = {
  allievo: 'Allievo',
  docente: 'Docente',
  relatore: 'Relatore',
  resp_ga: 'Responsabile GA',
  resp_sito: 'Responsabile sito',
};

async function usersPage(pool: Pool, q: string, flash = ''): Promise<string> {
  const users = await searchUsers(pool, q);
  const rows = users
    .map((u) => {
      const have = u.roles
        .map(
          (r) => `<form method="post" action="/admin/utenti/ruolo/togli" style="display:inline">
<input type="hidden" name="user" value="${u.id}"><input type="hidden" name="role" value="${r}"><input type="hidden" name="q" value="${esc(q)}">
${esc(ROLE_LABEL[r] ?? r)} <button title="Togli ruolo">×</button></form>`,
        )
        .join(' · ');
      const missing = ROLE_CODES.filter((r) => !u.roles.includes(r));
      const add = missing.length
        ? `<form method="post" action="/admin/utenti/ruolo/aggiungi" style="display:inline">
<input type="hidden" name="user" value="${u.id}"><input type="hidden" name="q" value="${esc(q)}">
<select name="role">${missing.map((r) => `<option value="${r}">${esc(ROLE_LABEL[r])}</option>`).join('')}</select> <button>Aggiungi</button></form>`
        : '';
      return `<tr><td>${esc(u.last_name)} ${esc(u.first_name)}<br><small>${esc(u.login_id)}</small></td><td>${have || '—'}</td><td>${add}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Utenti e ruoli</title></head><body>
<h1>Utenti e ruoli</h1>
${flash}
<form method="get" action="/admin/utenti"><p><input type="search" name="q" value="${esc(q)}" placeholder="Nome o ID"> <button>Cerca</button></p></form>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Utente</th><th>Ruoli</th><th></th></tr>${rows || '<tr><td colspan="3">Nessun utente trovato.</td></tr>'}</table>
</body></html>`;
}

async function invitesPage(pool: Pool, flash = ''): Promise<string> {
  const rows = (await listInvites(pool))
    .map((i) => {
      const stato = i.used_at ? 'usato' : i.expires_at < new Date() ? 'scaduto' : 'valido';
      return `<tr><td>${esc(i.last_name)} ${esc(i.first_name)}<br><small>${esc(i.email)}</small></td><td>${esc(ROLE_LABEL[i.role_code])}</td><td>${stato}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Inviti</title></head><body>
<h1>Inviti di docenti e relatori</h1>
${flash}
<form method="post" action="/admin/inviti">
<p><label>Tipo <select name="role">${INVITE_ROLES.map((r) => `<option value="${r}">${esc(ROLE_LABEL[r])}</option>`).join('')}</select></label></p>
<p><label>Nome <input name="firstName" required></label></p>
<p><label>Cognome <input name="lastName" required></label></p>
<p><label>E-mail (sarà il suo ID) <input type="email" name="email" required></label></p>
<p><button>Crea invito</button></p></form>
<p>Il link è monouso e scade dopo 14 giorni. Il sito non invia la mail: copia il link e mandalo tu.</p>
<h2>Inviti creati</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Persona</th><th>Tipo</th><th>Stato</th></tr>${rows || '<tr><td colspan="3">Nessun invito.</td></tr>'}</table>
</body></html>`;
}

const siteUrl = (req: { protocol: string; get(h: string): string | undefined }) =>
  (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

async function settingsPage(pool: Pool, url: string, flash = ''): Promise<string> {
  const [years, blocks, days] = await Promise.all([listSchoolYears(pool), listBlocks(pool), listGaDays(pool)]);
  const yearRows = years
    .map(
      (y) => `<tr><td>${esc(y.name)}</td><td>${
        y.is_current
          ? '<strong>corrente</strong>'
          : `<form method="post" action="/admin/impostazioni/anno/corrente"><input type="hidden" name="id" value="${y.id}"><button>Imposta come corrente</button></form>`
      }</td></tr>`,
    )
    .join('');
  const blockRows = blocks
    .map(
      (b) => `<tr><td><input form="b${b.id}" name="name" value="${esc(b.name)}" required size="10"></td>
<td><input form="b${b.id}" type="time" name="start" value="${b.start}" required></td>
<td><input form="b${b.id}" type="time" name="end" value="${b.end}" required></td>
<td>${b.kind === 'pausa' ? 'pausa' : 'blocco'}</td>
<td><form id="b${b.id}" method="post" action="/admin/impostazioni/blocco"><input type="hidden" name="id" value="${b.id}"><button>Salva</button></form></td></tr>`,
    )
    .join('');
  const dayRows = days
    .map(
      (d) => `<li>${d.day ? esc(d.day.split('-').reverse().join('.')) : 'giorno da definire'}
<form method="post" action="/admin/impostazioni/giorno/togli" style="display:inline"><input type="hidden" name="id" value="${d.id}"><button>Togli</button></form></li>`,
    )
    .join('');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Impostazioni</title></head><body>
<h1>Impostazioni</h1>
${flash}
<h2>Anno scolastico</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse">${yearRows}</table>
<form method="post" action="/admin/impostazioni/anno"><p><label>Nuovo anno <input name="name" placeholder="2027-2028" required pattern="\d{4}-\d{4}"></label> <button>Crea</button></p></form>
<h2>Blocchi orari</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Nome</th><th>Inizio</th><th>Fine</th><th>Tipo</th><th></th></tr>${blockRows}</table>
<h2>Date delle GA</h2>
<p>Date: <strong>${esc(gaDatesLabel(days))}</strong>. Il sito funziona anche senza date.</p>
<ul>${dayRows}</ul>
<form method="post" action="/admin/impostazioni/giorno"><p><label>Giorno <input type="date" name="day"></label> <button>Aggiungi</button> <small>(vuoto = giorno da definire)</small></p></form>
<h2>QR code del sito</h2>
<p>Indirizzo: <code>${esc(url)}</code></p>
<p><img src="/admin/impostazioni/qr.png" alt="QR code del sito" width="200" height="200"></p>
<p><a href="/admin/impostazioni/qr.png" download="qr-portale.png">Scarica l'immagine</a></p>
</body></html>`;
}

export function adminRouter(pool: Pool): Router {
  const router = Router();
  router.use('/admin', requireCan('admin.studentList'));

  router.get('/admin/studenti', async (_req, res, next) => {
    try {
      res.send(await page(pool));
    } catch (e) {
      next(e);
    }
  });

  router.post('/admin/studenti', async (req, res, next) => {
    try {
      const r = await importStudentIds(pool, String(req.body?.csv ?? ''));
      let flash = `<p><strong>Aggiunti ${r.added}, già presenti (ignorati) ${r.duplicates}, righe non valide ${r.errors.length}.</strong></p>`;
      if (r.errors.length) {
        flash += `<ul>${r.errors.map((e) => `<li>Riga ${e.line}: ${esc(e.value)}</li>`).join('')}</ul>`;
      }
      res.send(await page(pool, flash));
    } catch (e) {
      next(e);
    }
  });

  router.post('/admin/codice-generale', async (req, res, next) => {
    try {
      let flash = '<p><strong>Codice generale aggiornato.</strong></p>';
      try {
        await setGeneralCode(pool, String(req.body?.code ?? ''));
      } catch (e) {
        flash = `<p><strong>${esc((e as Error).message)}</strong></p>`;
      }
      res.send(await page(pool, flash));
    } catch (e) {
      next(e);
    }
  });

  router.get('/admin/utenti', requireCan('admin.users'), async (req, res, next) => {
    try {
      res.send(await usersPage(pool, String(req.query.q ?? '')));
    } catch (e) {
      next(e);
    }
  });

  for (const [path, fn] of [
    ['aggiungi', addUserRole],
    ['togli', dropUserRole],
  ] as const) {
    router.post(`/admin/utenti/ruolo/${path}`, requireCan('admin.users'), async (req, res, next) => {
      try {
        let flash = '<p><strong>Ruoli aggiornati.</strong></p>';
        try {
          await fn(pool, Number(req.body?.user), String(req.body?.role ?? ''));
        } catch (e) {
          flash = `<p><strong>${esc((e as Error).message)}</strong></p>`;
        }
        res.send(await usersPage(pool, String(req.body?.q ?? ''), flash));
      } catch (e) {
        next(e);
      }
    });
  }

  router.get('/admin/inviti', requireCan('admin.invites'), async (_req, res, next) => {
    try {
      res.send(await invitesPage(pool));
    } catch (e) {
      next(e);
    }
  });

  router.post('/admin/inviti', requireCan('admin.invites'), async (req, res, next) => {
    try {
      const b = req.body ?? {};
      let flash: string;
      try {
        const token = await createInvite(pool, {
          role: String(b.role ?? ''),
          firstName: String(b.firstName ?? ''),
          lastName: String(b.lastName ?? ''),
          email: String(b.email ?? ''),
        });
        const base = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        const link = `${base}/invito/${token}`;
        flash = `<p><strong>Invito creato. Copia il link (valido 14 giorni, una sola volta):</strong></p>
<p><input readonly size="60" value="${esc(link)}" onclick="this.select()"></p>`;
      } catch (e) {
        flash = `<p><strong>${esc((e as Error).message)}</strong></p>`;
      }
      res.send(await invitesPage(pool, flash));
    } catch (e) {
      next(e);
    }
  });

  router.get('/admin/impostazioni', requireCan('admin.settings'), async (req, res, next) => {
    try {
      res.send(await settingsPage(pool, siteUrl(req)));
    } catch (e) {
      next(e);
    }
  });

  router.get('/admin/impostazioni/qr.png', requireCan('admin.settings'), async (req, res, next) => {
    try {
      res.type('png').set('Content-Disposition', 'inline; filename="qr-portale.png"').send(await qrPng(siteUrl(req)));
    } catch (e) {
      next(e);
    }
  });

  const settingsActions = {
    'anno': (b: Record<string, unknown>) => createSchoolYear(pool, String(b.name ?? '')),
    'anno/corrente': (b: Record<string, unknown>) => setCurrentSchoolYear(pool, Number(b.id)),
    'blocco': (b: Record<string, unknown>) => updateBlock(pool, Number(b.id), String(b.name ?? ''), String(b.start ?? ''), String(b.end ?? '')),
    'giorno': (b: Record<string, unknown>) => addGaDay(pool, String(b.day ?? '')),
    'giorno/togli': (b: Record<string, unknown>) => removeGaDay(pool, Number(b.id)),
  };
  for (const [path, fn] of Object.entries(settingsActions)) {
    router.post(`/admin/impostazioni/${path}`, requireCan('admin.settings'), async (req, res, next) => {
      try {
        let flash = '<p><strong>Salvato.</strong></p>';
        try {
          await fn(req.body ?? {});
        } catch (e) {
          flash = `<p><strong>${esc((e as Error).message)}</strong></p>`;
        }
        res.send(await settingsPage(pool, siteUrl(req), flash));
      } catch (e) {
        next(e);
      }
    });
  }

  return router;
}

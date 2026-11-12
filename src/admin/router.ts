import { Router } from 'express';
import { Pool } from 'pg';
import { requireRole } from '../auth/guard';
import {
  countStudentIds,
  hasGeneralCode,
  importStudentIds,
  schoolDomain,
  setGeneralCode,
} from './studentList';

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

export function adminRouter(pool: Pool): Router {
  const router = Router();
  router.use('/admin', requireRole('resp_sito'));

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

  return router;
}

import { Router } from 'express';
import { Pool } from 'pg';
import { STATES, getEnrollState, mySessionIds } from '../ga/enroll';
import { listGaDays } from '../admin/settings';
import { can } from '../auth/permissions';
import { myMatches, myMatchesHtml } from '../tornei/mine';

export function homeRouter(pool: Pool): Router {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const state = await getEnrollState(pool);
      const days = (await listGaDays(pool)).filter((d) => d.day).map((d) => d.day!.split('-').reverse().join('.'));
      const enroll = can(req.user, 'ga.enroll');
      const n = enroll ? (await mySessionIds(pool, req.user!.id)).size : 0;
      const mine = req.user ? await myMatches(pool, req.user.id, 5) : [];
      res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Home</title></head><body>
<h1>Home</h1>
<p>Benvenuto nel portale delle Giornate Autogestite del CPT Trevano.</p>
<p>Date delle GA: <strong>${days.length ? days.join(', ') : 'da definire'}</strong></p>
<p>Iscrizioni alle GA: <strong>${STATES[state]}</strong></p>${
        enroll ? `<p>Attività scelte: <strong>${n}</strong> — <a href="/programma">il mio programma</a></p>` : ''
      }
${!req.user || can(req.user, 'ga.view') ? '<p><a href="/attivita">Vedi le attività</a></p>' : ''}
${mine.length ? `<h2>Le mie partite</h2>${myMatchesHtml(mine)}<p><a href="/tornei/mie">Tutte le mie partite</a> · <a href="/tornei">Tornei</a></p>` : ''}
<h2>Come funziona</h2>
<ul>
<li>Prima si iscrivono gli organizzatori di attività approvate (fase "Solo organizzatori"); poi le iscrizioni si aprono a tutti e chi arriva prima prende il posto: quando un'attività è piena non si può più scegliere.</li>
<li>Puoi scegliere una sola attività per ogni blocco orario.</li>
<li>Alla chiusura delle iscrizioni, chi ha ancora blocchi liberi viene assegnato a caso a un'attività con posti disponibili.</li>
</ul>
</body></html>`);
    } catch (e) {
      next(e);
    }
  });
  return router;
}

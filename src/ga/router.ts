import { Router } from 'express';
import { Pool } from 'pg';
import { requireCan } from '../auth/permissions';
import { listBlocks } from '../admin/settings';
import { esc } from '../ui/layout';
import { createSeatsHub } from './seats';
import { SessionRow, listRooms, listSessions } from './activities';

const KINDS: Record<string, string> = { allievo: 'Allievo', docente: 'Docente', relatore: 'Relatore' };

function card(rows: SessionRow[]): string {
  const a = rows[0];
  const sessions = rows
    .map((s) => {
      const full = s.enrolled >= s.max;
      return `<li data-session="${s.session_id}">${esc(s.block)} · ${s.start}–${s.end}
<progress value="${s.enrolled}" max="${s.max}"></progress>
<span class="seats">${full ? '<strong>Posti esauriti</strong>' : `${s.max - s.enrolled} posti liberi su ${s.max}`}</span></li>`;
    })
    .join('');
  return `<article style="border:1px solid #8886;border-radius:.5rem;padding:.5rem 1rem;margin:.75rem 0">
<h2 style="margin:.25rem 0">${esc(a.title)}</h2>
<p style="margin:.25rem 0">${esc(a.description)}</p>
<p style="margin:.25rem 0"><small>Aula: ${a.room ? esc(a.room) : 'da definire'} · ${esc(KINDS[a.organizer_kind])}: ${esc(a.organizer)}</small></p>
<ul style="margin:.25rem 0">${sessions}</ul></article>`;
}

export async function listPage(pool: Pool, query: Record<string, unknown>): Promise<string> {
  const s = (k: string) => String(query[k] ?? '');
  const f = { block: Number(s('block')) || undefined, room: Number(s('room')) || undefined, kind: s('kind') in KINDS ? s('kind') : undefined, q: s('q') };
  const [blocks, rooms, sessions] = await Promise.all([listBlocks(pool), listRooms(pool), listSessions(pool, f)]);
  const opt = (v: string | number | undefined, val: string | number, label: string) =>
    `<option value="${val}"${String(v ?? '') === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
  const byActivity = new Map<number, SessionRow[]>();
  for (const r of sessions) byActivity.set(r.activity_id, [...(byActivity.get(r.activity_id) ?? []), r]);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Attività</title></head><body>
<h1>Attività</h1>
<form method="get" action="/attivita"><p>
<select name="block" aria-label="Blocco">${opt(f.block, '', 'Tutti i blocchi')}${blocks
    .filter((b) => b.kind === 'blocco')
    .map((b) => opt(f.block, b.id, `${b.name} · ${b.start}–${b.end}`))
    .join('')}</select>
<select name="room" aria-label="Aula">${opt(f.room, '', 'Tutte le aule')}${rooms.map((r) => opt(f.room, r.id, r.name)).join('')}</select>
<select name="kind" aria-label="Organizzatore">${opt(f.kind, '', 'Tutti gli organizzatori')}${Object.entries(KINDS).map(([k, l]) => opt(f.kind, k, l)).join('')}</select>
<input type="search" name="q" value="${esc(f.q)}" placeholder="Cerca titolo, descrizione, persona">
<button>Filtra</button></p></form>
<div id="elenco">${[...byActivity.values()].map(card).join('') || '<p>Nessuna attività trovata.</p>'}</div>
<script>
(function(){
  function show(map){
    document.querySelectorAll('li[data-session]').forEach(function(li){
      var s=map[li.getAttribute('data-session')]; if(!s) return;
      li.querySelector('progress').max=s.max; li.querySelector('progress').value=s.n;
      li.querySelector('.seats').innerHTML=s.n>=s.max?'<strong>Posti esauriti</strong>':(s.max-s.n)+' posti liberi su '+s.max;
    });
  }
  // EventSource si riconnette da solo se la connessione cade; a ogni connessione il server rimanda lo stato.
  new EventSource('/attivita/eventi').onmessage=function(e){show(JSON.parse(e.data));};
})();
</script>
</body></html>`;
}

export function gaRouter(pool: Pool): Router {
  const router = Router();
  const subscribe = createSeatsHub(pool);

  router.get('/attivita/eventi', requireCan('ga.view'), (_req, res) => {
    subscribe(res).catch(() => res.end());
  });

  router.get('/attivita', requireCan('ga.view'), async (req, res, next) => {
    try {
      res.send(await listPage(pool, req.query));
    } catch (e) {
      next(e);
    }
  });

  return router;
}

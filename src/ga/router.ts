import { Router } from 'express';
import { Pool } from 'pg';
import { requireCan } from '../auth/permissions';
import { listBlocks, listGaDays } from '../admin/settings';
import { esc } from '../ui/layout';
import { createProposal, parseProposal, blockLabel, roomsWithUsage } from './proposals';
import { Pending, approveProposal, blockLoad, listPending, materialsCsv, materialsList, rejectProposal, saveProposal } from './approval';
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

async function proposePage(pool: Pool, user: { id: number }, v: Record<string, unknown> = {}, flash = ''): Promise<string> {
  const [blocks, rooms, days, me] = await Promise.all([
    listBlocks(pool),
    roomsWithUsage(pool),
    listGaDays(pool),
    pool.query('SELECT first_name, last_name, login_id FROM users WHERE id = $1', [user.id]),
  ]);
  const g = (k: string) => esc(String(v[k] ?? ''));
  const opt = (k: string, val: string | number, label: string) =>
    `<option value="${val}"${String(v[k] ?? '') === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
  const blockOpts = (k: string) =>
    `<option value="">—</option>` + blocks.filter((b) => b.kind === 'blocco').map((b) => opt(k, b.id, blockLabel(b))).join('');
  const who = me.rows[0];
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Proponi un'attività</title></head><body>
<h1>Proponi un'attività</h1>
${flash}
<form method="post" action="/proponi">
<p><label>Organizzatore <input value="${esc(`${who.first_name} ${who.last_name} (${who.login_id})`)}" readonly size="40"></label></p>
<p><label>Nome dell'attività <input name="title" value="${g('title')}" required maxlength="120"></label></p>
<p><label>Breve spiegazione<br><textarea name="description" rows="4" cols="50" required>${g('description')}</textarea></label></p>
<p><label>Telefono <input name="phone" value="${g('phone')}" required maxlength="40"></label> <small>(l'e-mail è già nota)</small></p>
<p><label>Aula o spazio preferito <select name="room"><option value="">Nessuna preferenza</option>${rooms
    .map((r) => opt('room', r.id, `${r.name} — ${r.busy.length ? 'occupata: ' + r.busy.join(', ') : 'libera'}`))
    .join('')}</select></label></p>
<p><label>Giorno <select name="day"><option value="">Da definire</option>${days
    .map((d) => opt('day', d.id, d.day ? d.day.split('-').reverse().join('.') : 'giorno da definire'))
    .join('')}</select></label></p>
<p><label>Blocco di prima scelta <select name="first" required>${blockOpts('first')}</select></label></p>
<p><label>Blocco di seconda scelta <select name="second" required>${blockOpts('second')}</select></label></p>
<p><label>Durata (blocchi consecutivi) <input type="number" name="duration" min="1" max="4" value="${g('duration') || '1'}" required></label></p>
<p><label><input type="checkbox" name="repeat" value="1"${v.repeat === '1' ? ' checked' : ''}> Ripeti l'attività (due volte, in due blocchi diversi, con iscritti diversi)</label></p>
<p><label>Materiali che ti servono (es. proiettore, 10 sedie, palloni)<br><textarea name="materials" rows="2" cols="50">${g('materials')}</textarea></label></p>
<p><label>Minimo allievi <input type="number" name="min" min="0" value="${g('min') || '0'}"></label>
<label>Massimo allievi <input type="number" name="max" min="1" value="${g('max')}" required></label></p>
<p><button>Invia la proposta</button></p></form>
</body></html>`;
}

async function approvalPage(pool: Pool, flash = ''): Promise<string> {
  const [pending, blocks, rooms, load, materials] = await Promise.all([
    listPending(pool),
    listBlocks(pool),
    listRooms(pool),
    blockLoad(pool),
    materialsList(pool),
  ]);
  const realBlocks = blocks.filter((b) => b.kind === 'blocco');
  const blockOpts = (sel: number) =>
    realBlocks
      .map((b) => {
        const l = load.get(b.id) ?? { activities: 0, seats: 0 };
        return `<option value="${b.id}"${b.id === sel ? ' selected' : ''}>${esc(blockLabel(b))} — ${l.activities} attività, ${l.seats} posti</option>`;
      })
      .join('');
  const name = (id: number | null) => (id ? realBlocks.find((b) => b.id === id)?.name ?? '' : '');
  const item = (a: Pending) => {
    const sessions = Array.from({ length: a.repetitions }, (_, i) =>
      `<p><label>${a.repetitions > 1 ? `Sessione ${i + 1}` : 'Blocco definitivo'} (${a.duration_blocks} bl.) <select name="block${i + 1}">${blockOpts(
        i === 0 ? a.first_block_id : a.second_block_id,
      )}</select></label></p>`).join('');
    return `<form method="post" action="/approvazione/${a.id}" style="border:1px solid #8886;border-radius:.5rem;padding:.5rem 1rem;margin:.75rem 0">
<h2 style="margin:.25rem 0">${esc(a.title)}</h2>
<p><small>${esc(a.organizer)} (${esc(a.email)}) · tel. ${esc(a.contact)} · prima scelta ${esc(name(a.first_block_id))}, seconda ${esc(name(a.second_block_id))}</small></p>
<p><label>Titolo <input name="title" value="${esc(a.title)}" required></label></p>
<p><label>Descrizione<br><textarea name="description" rows="3" cols="50" required>${esc(a.description)}</textarea></label></p>
<p><label>Telefono <input name="phone" value="${esc(a.contact)}"></label>
<label>Aula <select name="room"><option value="">Da definire</option>${rooms
      .map((r) => `<option value="${r.id}"${r.id === a.room_id ? ' selected' : ''}>${esc(r.name)}</option>`)
      .join('')}</select></label></p>
<p><label>Materiali <input name="materials" value="${esc(a.materials)}" size="40"></label></p>
<p><label>Minimo <input type="number" name="min" min="0" value="${a.min_participants}"></label>
<label>Massimo <input type="number" name="max" min="1" value="${a.max_participants}" required></label></p>
${sessions}
<p><button name="action" value="approve">Approva</button> <button name="action" value="save">Salva modifiche</button>
<input name="reason" placeholder="Motivo del rifiuto (facoltativo)" size="30"> <button name="action" value="reject">Rifiuta</button></p></form>`;
  };
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Approvazione attività</title></head><body>
<h1>Attività da approvare</h1>
${flash}
${pending.map(item).join('') || '<p>Nessuna proposta da approvare.</p>'}
<h2>Materiali richiesti (attività approvate)</h2>
<p><a href="/approvazione/materiali.csv">Esporta in CSV</a></p>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Attività</th><th>Organizzatore</th><th>Materiali</th></tr>${
    materials.map((m) => `<tr><td>${esc(m.title)}</td><td>${esc(m.organizer)}</td><td>${esc(m.materials)}</td></tr>`).join('') ||
    '<tr><td colspan="3">Nessun materiale richiesto.</td></tr>'
  }</table>
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

  router.get('/proponi', requireCan('ga.propose'), async (req, res, next) => {
    try {
      res.send(await proposePage(pool, req.user!));
    } catch (e) {
      next(e);
    }
  });

  router.post('/proponi', requireCan('ga.propose'), async (req, res, next) => {
    try {
      const body = req.body ?? {};
      try {
        await createProposal(pool, req.user!.id, parseProposal(body));
        res.send(await proposePage(pool, req.user!, {}, "<p><strong>Proposta inviata: sarà visibile dopo l'approvazione.</strong></p>"));
      } catch (e) {
        res.status(400).send(await proposePage(pool, req.user!, body, `<p><strong>${esc((e as Error).message)}</strong></p>`));
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/approvazione', requireCan('ga.approve'), async (_req, res, next) => {
    try {
      res.send(await approvalPage(pool));
    } catch (e) {
      next(e);
    }
  });

  router.get('/approvazione/materiali.csv', requireCan('ga.approve'), async (_req, res, next) => {
    try {
      res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="materiali-ga.csv"').send(materialsCsv(await materialsList(pool)));
    } catch (e) {
      next(e);
    }
  });

  router.post('/approvazione/:id', requireCan('ga.approve'), async (req, res, next) => {
    try {
      const b = req.body ?? {};
      const id = Number(req.params.id);
      const s = (k: string) => String(b[k] ?? '').trim();
      const edit = { title: s('title'), description: s('description'), contact: s('phone'), roomId: Number(s('room')) || null, materials: s('materials'), min: Number(s('min') || 0), max: Number(s('max')) };
      let flash = '<p><strong>Fatto.</strong></p>';
      try {
        if (b.action === 'reject') await rejectProposal(pool, id, s('reason'));
        else if (b.action === 'save') await saveProposal(pool, id, edit);
        else await approveProposal(pool, id, edit, [Number(s('block1')), Number(s('block2'))].slice(0, s('block2') ? 2 : 1));
      } catch (e) {
        flash = `<p><strong>${esc((e as Error).message)}</strong></p>`;
      }
      res.send(await approvalPage(pool, flash));
    } catch (e) {
      next(e);
    }
  });

  return router;
}

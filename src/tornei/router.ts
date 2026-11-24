import { Request, Router } from 'express';
import { Pool } from 'pg';
import { can } from '../auth/permissions';
import { esc } from '../ui/layout';
import { CRITERIA, FORMATS, Tournament, addField, addPerson, approvedActivities, canCreate, canManage, canSee, createTournament, getTournament, hasMatches, listFields, people, removeField, removePerson, setStatus, updateTournament } from './service';
import { doc, go, takeFlash } from './ui';

const chk = (v: boolean) => (v ? ' checked' : '');
const sel = (v: unknown, o: unknown) => (String(v) === String(o) ? ' selected' : '');

function form(t: Partial<Tournament>, activities: { id: number; title: string }[], action: string, locked: boolean, create: boolean): string {
  const num = (k: keyof Tournament, label: string, min = 0) =>
    `<p><label>${label} <input type="number" name="${k}" value="${t[k] ?? ''}" min="${min}" required${locked ? ' readonly' : ''}></label></p>`;
  const ro = locked ? ' disabled' : '';
  return `<form method="post" action="${action}">
<p><label>Nome <input name="name" value="${esc(t.name ?? '')}" required maxlength="100"></label></p>
<p><label>Sport <input name="sport" value="${esc(t.sport ?? '')}" required maxlength="50"${locked ? ' readonly' : ''}></label></p>
${create ? `<p><label>Attività GA collegata <select name="activity_id"><option value="">nessuna</option>${activities.map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select></label></p>` : ''}
<p><label>Descrizione<br><textarea name="description" rows="3" cols="50">${esc(t.description ?? '')}</textarea></label></p>
<p><label>Regolamento<br><textarea name="rules" rows="6" cols="50">${esc(t.rules ?? '')}</textarea></label></p>
<fieldset${ro}><legend>Impostazioni${locked ? ' (bloccate: il calendario è stato generato)' : ''}</legend>
<p><label>Modalità <select name="mode"><option value="squadre"${sel(t.mode, 'squadre')}>Squadre</option><option value="singoli"${sel(t.mode, 'singoli')}>Singoli</option></select></label></p>
${num('team_min', 'Giocatori per squadra (min)', 1)}${num('team_max', 'Giocatori per squadra (max)', 1)}
${num('max_teams', 'Massimo squadre / iscritti', 2)}
<p><label>Formato <select name="format">${Object.entries(FORMATS).map(([k, l]) => `<option value="${k}"${sel(t.format, k)}>${l}</option>`).join('')}</select></label></p>
<p><label><input type="checkbox" name="double_round"${chk(!!t.double_round)}> Girone con andata e ritorno</label></p>
${num('groups_count', 'Numero di gironi (gironi + eliminazione)', 1)}${num('qualifiers', 'Qualificate per girone', 1)}
<p><label>Punteggio <select name="score_type"><option value="punti"${sel(t.score_type, 'punti')}>Punti/gol (due numeri)</option><option value="set"${sel(t.score_type, 'set')}>Set</option></select></label></p>
${num('best_of', 'Set: al meglio di (dispari)', 1)}
${num('pts_win', 'Punti per vittoria')}${num('pts_draw', 'Punti per pareggio')}${num('pts_loss', 'Punti per sconfitta')}
${num('forfeit_score', 'Punteggio della vittoria a tavolino (forfait)')}
${num('match_minutes', 'Durata partita (minuti)', 1)}
<p><label>Criteri di spareggio, in ordine (${Object.keys(CRITERIA).join(', ')}) <input name="tiebreaks" value="${esc(t.tiebreaks ?? 'punti,scontro_diretto,differenza,fatti,sorteggio')}" size="60"></label></p>
</fieldset>
<p><button>${create ? 'Crea torneo' : 'Salva'}</button></p></form>`;
}

export function torneiRouter(pool: Pool): Router {
  const router = Router();

  // Tutte le pagine dei tornei richiedono il login.
  router.use('/tornei', (req, res, next) => (req.user ? next() : res.redirect('/login')));

  router.get('/tornei', async (req, res, next) => {
    try {
      const user = req.user!;
      const { rows } = await pool.query<Tournament & { teams: number }>(
        `SELECT t.*, y.name AS year_name, (SELECT count(*)::int FROM tournament_teams x WHERE x.tournament_id = t.id) AS teams
         FROM tournaments t JOIN school_years y ON y.id = t.school_year_id WHERE y.is_current ORDER BY t.created_at DESC`,
      );
      const visible: (Tournament & { teams: number })[] = [];
      for (const t of rows) if (await canSee(pool, user, t)) visible.push(t);
      const items = visible
        .map((t) => `<li><a href="/tornei/${t.id}">${esc(t.name)}</a> · ${esc(t.sport)} · ${t.status} · ${t.teams}/${t.max_teams} ${t.mode === 'singoli' ? 'iscritti' : 'squadre'}</li>`)
        .join('');
      res.send(doc('Tornei', `<h1>Tornei</h1>${takeFlash(req, res)}${(await canCreate(pool, user)) ? '<p><a href="/tornei/nuovo">Crea un torneo</a></p>' : ''}<ul>${items || '<li>Nessun torneo.</li>'}</ul>`));
    } catch (e) {
      next(e);
    }
  });

  router.get('/tornei/nuovo', async (req, res, next) => {
    try {
      if (!(await canCreate(pool, req.user!))) return void res.status(403).send('Non autorizzato');
      const acts = await approvedActivities(pool, can(req.user, 'tornei.manage') ? undefined : req.user!.id);
      res.send(doc('Nuovo torneo', `<h1>Nuovo torneo</h1>${takeFlash(req, res)}${form({ team_min: 1, team_max: 5, max_teams: 16, groups_count: 2, qualifiers: 2, best_of: 3, pts_win: 3, pts_draw: 1, pts_loss: 0, forfeit_score: 3, match_minutes: 30 }, acts, '/tornei/nuovo', false, true)}`));
    } catch (e) {
      next(e);
    }
  });

  router.post('/tornei/nuovo', async (req, res, next) => {
    try {
      let id: number;
      try {
        id = await createTournament(pool, req.user!, req.body);
      } catch (e) {
        return go(res, '/tornei/nuovo', (e as Error).message);
      }
      go(res, `/tornei/${id}/gestione`, 'Torneo creato (in bozza).');
    } catch (e) {
      next(e);
    }
  });

  const load = async (req: Request) => {
    const t = await getTournament(pool, Number(req.params.id));
    return t && (await canSee(pool, req.user, t)) ? t : undefined;
  };

  router.get('/tornei/:id(\\d+)', async (req, res, next) => {
    try {
      const t = await load(req);
      if (!t) return void res.status(404).send('Torneo non trovato');
      const manage = await canManage(pool, req.user, t.id);
      res.send(doc(t.name, `<h1>${esc(t.name)}</h1>${takeFlash(req, res)}
<p>${esc(t.sport)} · ${FORMATS[t.format]} · stato: <strong>${t.status}</strong> · anno ${esc(t.year_name)}</p>
${manage ? `<p><a href="/tornei/${t.id}/gestione">Gestisci il torneo</a></p>` : ''}
<p>${esc(t.description)}</p><h2>Regolamento</h2><p style="white-space:pre-wrap">${esc(t.rules)}</p>`));
    } catch (e) {
      next(e);
    }
  });

  // --- gestione (solo Responsabile tornei e organizzatori del torneo)
  const managed = async (req: Request) => {
    const t = await getTournament(pool, Number(req.params.id));
    return t && (await canManage(pool, req.user, t.id)) ? t : undefined;
  };

  router.get('/tornei/:id(\\d+)/gestione', async (req, res, next) => {
    try {
      const t = await managed(req);
      if (!t) return void res.status(403).send('Non autorizzato');
      const locked = await hasMatches(pool, t.id);
      const [orgs, refs, fields] = await Promise.all([people(pool, t.id, 'organizers'), people(pool, t.id, 'referees'), listFields(pool, t.id)]);
      const person = (kind: string, p: { id: number; name: string }) =>
        `<li>${esc(p.name)} <form method="post" action="/tornei/${t.id}/persone/${kind}/togli" style="display:inline"><input type="hidden" name="user" value="${p.id}"><button>Togli</button></form></li>`;
      const add = (kind: string, label: string) =>
        `<form method="post" action="/tornei/${t.id}/persone/${kind}"><p><label>${label} (nome o ID) <input name="q" required></label> <button>Aggiungi</button></p></form>`;
      const next_ = t.status === 'bozza' ? 'iscrizioni' : t.status === 'iscrizioni' && !locked ? 'bozza' : t.status === 'in corso' ? 'concluso' : '';
      res.send(doc(`Gestione ${t.name}`, `<h1>Gestione: ${esc(t.name)}</h1>${takeFlash(req, res)}
<p><a href="/tornei/${t.id}">Pagina del torneo</a> · stato: <strong>${t.status}</strong>${
        next_ ? ` <form method="post" action="/tornei/${t.id}/stato" style="display:inline"><input type="hidden" name="to" value="${next_}"><button>Passa a "${next_}"</button></form>` : ''
      }</p>
${form(t, [], `/tornei/${t.id}/gestione`, locked, false)}
<h2>Organizzatori</h2><ul>${orgs.map((p) => person('organizers', p)).join('')}</ul>${add('organizers', 'Aggiungi organizzatore')}
<h2>Arbitri</h2><ul>${refs.map((p) => person('referees', p)).join('') || '<li>Nessuno</li>'}</ul>${add('referees', 'Aggiungi arbitro')}
<h2>Campi / spazi</h2><ul>${fields.map((f) => `<li>${esc(f.name)} <form method="post" action="/tornei/${t.id}/campi/${f.id}/togli" style="display:inline"><button>Togli</button></form></li>`).join('') || '<li>Nessuno</li>'}</ul>
<form method="post" action="/tornei/${t.id}/campi"><p><label>Nuovo campo <input name="name" required placeholder="Palestra A"></label> <button>Aggiungi</button></p></form>`));
    } catch (e) {
      next(e);
    }
  });

  // Azioni di gestione: esito nel cookie, ritorno alla pagina di gestione.
  const act = (path: string, fn: (req: Request, id: number) => Promise<string | void>) =>
    router.post(`/tornei/:id(\\d+)/${path}`, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        let m = 'Fatto.';
        try {
          m = (await fn(req, id)) ?? m;
        } catch (e) {
          m = (e as Error).message;
        }
        go(res, `/tornei/${id}/gestione`, m);
      } catch (e) {
        next(e);
      }
    });
  act('gestione', async (req, id) => {
    await updateTournament(pool, req.user!, id, req.body);
    return 'Salvato.';
  });
  act('stato', (req, id) => setStatus(pool, req.user!, id, String(req.body.to)));
  const kinds = { organizers: 'organizers', referees: 'referees' } as const;
  act('persone/:kind', (req, id) => addPerson(pool, req.user!, id, kinds[req.params.kind as keyof typeof kinds] ?? 'referees', String(req.body.q ?? '')));
  act('persone/:kind/togli', (req, id) => removePerson(pool, req.user!, id, kinds[req.params.kind as keyof typeof kinds] ?? 'referees', Number(req.body.user)));
  act('campi', (req, id) => addField(pool, req.user!, id, String(req.body.name ?? '')));
  act('campi/:fid/togli', (req, id) => removeField(pool, req.user!, id, Number(req.params.fid)));

  return router;
}

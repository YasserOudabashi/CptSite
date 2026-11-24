import { Request, Router } from 'express';
import { Pool } from 'pg';
import { can } from '../auth/permissions';
import { esc } from '../ui/layout';
import { CRITERIA, FORMATS, Tournament, addField, addPerson, approvedActivities, canCreate, canManage, canSee, createTournament, getTournament, hasMatches, listFields, people, removeField, removePerson, setStatus, updateTournament } from './service';
import { addMember, addTeamManual, approveTeam, confirmMember, joinTournament, listTeams, removeMember, teamsSection, withdrawTeam } from './teams';
import { generateCalendar, previewHtml, previewPlan, setSeedNo } from './calendar';
import { loadMatches, roundName, slotLabel } from './matches';
import { autoAssign, editMatch, gaWarnings } from './schedule';
import { matchLine } from './view';
import { doc, go, localInput, takeFlash } from './ui';

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
        .map((t) => `<li><a href="/tornei/${t.id}">${esc(t.name)}</a> · ${esc(t.sport)} · ${t.status} · ${t.teams}/${t.max_teams} ${t.mode === 'singoli' ? 'iscritti' : 'squadre'} (${Math.max(0, t.max_teams - t.teams)} posti rimasti)</li>`)
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
      const matches = await loadMatches(pool, t.id);
      const gmap = new Map((await pool.query<{ id: number; name: string }>('SELECT id, name FROM tournament_groups WHERE tournament_id = $1', [t.id])).rows.map((g) => [g.id, g.name]));
      res.send(doc(t.name, `<h1>${esc(t.name)}</h1>${takeFlash(req, res)}
<p>${esc(t.sport)} · ${FORMATS[t.format]} · stato: <strong>${t.status}</strong> · anno ${esc(t.year_name)}</p>
${manage ? `<p><a href="/tornei/${t.id}/gestione">Gestisci il torneo</a></p>` : ''}
<p>${esc(t.description)}</p><h2>Regolamento</h2><p style="white-space:pre-wrap">${esc(t.rules)}</p>
${teamsSection(t, await listTeams(pool, t), req.user!, manage)}
${matches.length ? `<h2>Partite</h2><ul>${matches.map((m) => matchLine(m, matches, gmap)).join('')}</ul>` : ''}`));
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
<p><a href="/tornei/${t.id}">Pagina del torneo</a>${['iscrizioni', 'in corso'].includes(t.status) ? ` · <a href="/tornei/${t.id}/calendario">Calendario: anteprima e generazione</a>` : ''}${t.status === 'in corso' ? ` · <a href="/tornei/${t.id}/programma">Campi e orari</a>` : ''} · stato: <strong>${t.status}</strong>${
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

  // --- iscrizione di squadre e giocatori (esito nel cookie, ritorno alla pagina del torneo)
  const join = (path: string, fn: (req: Request, id: number) => Promise<void>, ok: string) =>
    router.post(`/tornei/:id(\\d+)/${path}`, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        let m = ok;
        try {
          await fn(req, id);
        } catch (e) {
          m = (e as Error).message;
        }
        go(res, `/tornei/${id}`, m);
      } catch (e) {
        next(e);
      }
    });
  const team = (req: Request) => Number(req.params.team);
  join('squadre', (req, id) => joinTournament(pool, req.user!, id, String(req.body.name ?? '')), 'Iscrizione registrata.');
  join('squadre/manuale', (req, id) => addTeamManual(pool, req.user!, id, String(req.body.name ?? ''), String(req.body.q ?? '')), 'Aggiunto.');
  join('squadre/:team(\\d+)/membri', (req, id) => addMember(pool, req.user!, id, team(req), String(req.body.q ?? '')), 'Compagno aggiunto: deve confermare dal sito.');
  join('squadre/:team(\\d+)/membri/:uid(\\d+)/togli', (req, id) => removeMember(pool, req.user!, id, team(req), Number(req.params.uid)), 'Giocatore tolto.');
  join('squadre/:team(\\d+)/conferma', (req, id) => confirmMember(pool, req.user!, id, team(req)), 'Hai confermato.');
  join('squadre/:team(\\d+)/ritira', (req, id) => withdrawTeam(pool, req.user!, id, team(req)), 'Squadra ritirata.');
  join('squadre/:team(\\d+)/approva', (req, id) => approveTeam(pool, req.user!, id, team(req), req.body.to === '1'), 'Fatto.');

  // --- calendario: anteprima (non salva), teste di serie, conferma
  router.get('/tornei/:id(\\d+)/calendario', async (req, res, next) => {
    try {
      const t = await managed(req);
      if (!t) return void res.status(403).send('Non autorizzato');
      const seed = Number(req.query.seed) || Math.floor(Math.random() * 1e9);
      let body: string;
      try {
        if (!['iscrizioni', 'in corso'].includes(t.status)) throw new Error('Il calendario si genera con le iscrizioni aperte (o con il torneo in corso, finché non ci sono risultati).');
        const p = await previewPlan(pool, t, seed);
        const seeds = `<form method="post" action="/tornei/${t.id}/serie"><details><summary>Teste di serie (facoltative)</summary>${p.teams
          .map((x) => `<p><label>${esc(x.name)} <input type="number" min="1" name="s${x.id}" value="${x.seed_no ?? ''}" style="width:4rem"></label></p>`)
          .join('')}<button>Salva teste di serie</button></details></form>`;
        body = seeds + previewHtml(t, p, seed);
      } catch (e) {
        body = `<p>${esc((e as Error).message)}</p>`;
      }
      res.send(doc(`Calendario ${t.name}`, `<h1>Calendario: ${esc(t.name)}</h1>${takeFlash(req, res)}<p><a href="/tornei/${t.id}/gestione">Gestione</a></p>${body}`));
    } catch (e) {
      next(e);
    }
  });
  router.post('/tornei/:id(\\d+)/calendario', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      try {
        await generateCalendar(pool, req.user!, id, Number(req.body.seed) || 1);
      } catch (e) {
        return go(res, `/tornei/${id}/calendario`, (e as Error).message);
      }
      go(res, `/tornei/${id}`, 'Calendario generato: il torneo è in corso.');
    } catch (e) {
      next(e);
    }
  });
  router.post('/tornei/:id(\\d+)/serie', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      let m = 'Teste di serie salvate.';
      try {
        for (const [k, v] of Object.entries(req.body as Record<string, string>)) {
          if (/^s\d+$/.test(k)) await setSeedNo(pool, req.user!, id, Number(k.slice(1)), String(v).trim() ? Number(v) : null);
        }
      } catch (e) {
        m = (e as Error).message;
      }
      go(res, `/tornei/${id}/calendario`, m);
    } catch (e) {
      next(e);
    }
  });

  // --- campi, orari e arbitri (solo chi gestisce)
  router.get('/tornei/:id(\\d+)/programma', async (req, res, next) => {
    try {
      const t = await managed(req);
      if (!t) return void res.status(403).send('Non autorizzato');
      const [matches, fields, refs, warns, groups] = await Promise.all([
        loadMatches(pool, t.id),
        listFields(pool, t.id),
        people(pool, t.id, 'referees'),
        gaWarnings(pool, t.id),
        pool.query<{ id: number; name: string }>('SELECT id, name FROM tournament_groups WHERE tournament_id = $1', [t.id]),
      ]);
      const gmap = new Map(groups.rows.map((g) => [g.id, g.name]));
      const opt = (rows: { id: number; name: string }[], cur: number | null) => `<option value="">—</option>${rows.map((r) => `<option value="${r.id}"${r.id === cur ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}`;
      const rows = matches
        .map((m) => `<li><strong>${esc(slotLabel(m.home, m.home_src, gmap))} – ${esc(slotLabel(m.away, m.away_src, gmap))}</strong> (${esc(m.group_name ?? roundName(matches, m))}) ${m.status === 'finita' ? '(finita)' : ''}
<form method="post" action="/tornei/${t.id}/partite/${m.id}/orario">
<select name="field" aria-label="Campo">${opt(fields, m.field_id)}</select>
<input type="datetime-local" name="start" value="${localInput(m.starts_at)}" aria-label="Data e ora">
<select name="referee" aria-label="Arbitro">${opt(refs, m.referee_id)}</select>
<input name="reason" placeholder="Motivo del rinvio" value="${esc(m.postponed_reason ?? '')}"> <button>Salva</button></form>
${(warns.get(m.id) ?? []).map((w) => `<br><em>Attenzione: ${esc(w)}</em>`).join('')}</li>`)
        .join('');
      res.send(doc(`Programma ${t.name}`, `<h1>Campi e orari: ${esc(t.name)}</h1>${takeFlash(req, res)}<p><a href="/tornei/${t.id}/gestione">Gestione</a></p>
<form method="post" action="/tornei/${t.id}/programma/auto"><p>Assegnazione automatica da <input type="datetime-local" name="start" required> pausa tra partite (minuti) <input type="number" name="pause" value="10" min="0" style="width:4rem"> <button>Assegna campi, orari e arbitri</button></p></form>
<p><small>Durata partita: ${t.match_minutes} minuti. Il sito blocca due partite sullo stesso campo, o con la stessa squadra o lo stesso arbitro, in orari sovrapposti.</small></p>
<ul>${rows || '<li>Nessuna partita: genera prima il calendario.</li>'}</ul>`));
    } catch (e) {
      next(e);
    }
  });
  const prog = (path: string, fn: (req: Request, id: number) => Promise<string>) =>
    router.post(`/tornei/:id(\\d+)/${path}`, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        let m: string;
        try {
          m = await fn(req, id);
        } catch (e) {
          m = (e as Error).message;
        }
        go(res, `/tornei/${id}/programma`, m);
      } catch (e) {
        next(e);
      }
    });
  prog('programma/auto', async (req, id) => `Assegnate ${await autoAssign(pool, req.user!, id, String(req.body.start ?? ''), Number(req.body.pause))} partite.`);
  prog('partite/:mid(\\d+)/orario', (req, id) => editMatch(pool, req.user!, id, Number(req.params.mid), req.body));

  return router;
}

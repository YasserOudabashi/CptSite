import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { torneiRouter } from '../src/tornei/router';
import { homeRouter } from '../src/ui/home';
import { menuFor } from '../src/ui/layout';
import { generateCalendar } from '../src/tornei/calendar';
import { autoAssign } from '../src/tornei/schedule';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let me: number | null = 0;
const u: Record<string, number> = {};
let t: number;
let draft: number;
const f: Record<string, number> = {};

const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;
const as = (n: string | null) => {
  me = n ? u[n] : null;
};
const get = (path: string) => fetch(`${base}${path}`, { redirect: 'manual' });

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  for (const n of ['org', 'ref', 'p1', 'p2', 'p3', 'ext']) {
    u[n] = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'T') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
  }
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const mk = async (name: string, status: string) =>
    (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, rules, status, max_teams, match_minutes) VALUES ($1,$2,$3,'Pallavolo','Regole del torneo',$4,8,30) RETURNING id`, [y, u.org, name, status])).rows[0].id;
  t = await mk('Torneo visibile', 'iscrizioni');
  draft = await mk('Torneo segreto', 'bozza');
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [t, u.org]);
  await pool.query('INSERT INTO tournament_referees VALUES ($1,$2)', [t, u.ref]);
  for (const n of ['p1', 'p2', 'p3']) {
    const id = (await pool.query(`INSERT INTO tournament_teams (tournament_id, name) VALUES ($1,$2) RETURNING id`, [t, `Team ${n}`])).rows[0].id;
    await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [id, t, u[n]]);
    f[n] = id;
  }
  await pool.query(`UPDATE tournaments SET team_min = 1, team_max = 1 WHERE id = $1`, [t]);
  for (const n of ['Palestra A', 'Campo B']) f[n] = (await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2) RETURNING id', [t, n])).rows[0].id;
  const org = { id: u.org, roles: ['allievo'] as never };
  await generateCalendar(pool, org, t, 1);
  await autoAssign(pool, org, t, '2027-05-03T09:00', 10);
  await pool.query(`UPDATE tournament_matches SET starts_at = starts_at + interval '1 day' WHERE id = (SELECT max(id) FROM tournament_matches WHERE tournament_id = $1)`, [t]);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    if (me) req.user = { id: me, roles: ['allievo'] } as never;
    next();
  });
  app.use(homeRouter(pool));
  app.use(torneiRouter(pool));
  server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await stopDb();
});

test('US-038: tutti gli utenti loggati vedono i tornei non in bozza; la bozza no; senza login si va al login', async () => {
  as('ext');
  const list = await (await get('/tornei')).text();
  assert.match(list, /Torneo visibile/);
  assert.doesNotMatch(list, /Torneo segreto/);
  assert.equal((await get(`/tornei/${draft}`)).status, 404);
  as(null);
  assert.equal((await get('/tornei')).headers.get('location'), '/login');
  assert.equal((await get('/tornei/mie')).headers.get('location'), '/login');
});

test('US-038: pagina torneo con regolamento, squadre, calendario, classifiche, risultati', async () => {
  as('ext');
  const html = await (await get(`/tornei/${t}`)).text();
  assert.match(html, /Regole del torneo/);
  assert.match(html, /Team p1/);
  assert.match(html, /Girone A/);
  assert.match(html, /Palestra A|Campo B/);
  assert.match(html, /<h2>Partite<\/h2>/);
  assert.match(html, /new EventSource\('\/tornei\/\d+\/eventi'\)/);
  // un risultato compare sia in calendario sia in classifica
  const m = (await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY id LIMIT 1', [t]))[0];
  await pool.query(`UPDATE tournament_matches SET status = 'finita', home_score = 3, away_score = 1, winner_id = home_id WHERE id = $1`, [m.id]);
  assert.match(await (await get(`/tornei/${t}`)).text(), /<strong>3–1<\/strong>/);
});

test('US-038: filtri per giorno, campo e squadra', async () => {
  as('ext');
  const count = (h: string) => (h.match(/data-match=/g) ?? []).length;
  assert.equal(count(await (await get(`/tornei/${t}`)).text()), 3);
  const days = (await q(`SELECT DISTINCT (starts_at AT TIME ZONE 'Europe/Zurich')::date::text AS d FROM tournament_matches WHERE tournament_id = $1 ORDER BY 1`, [t])).map((r) => r.d);
  assert.deepEqual(days, ['2027-05-03', '2027-05-04']);
  assert.equal(count(await (await get(`/tornei/${t}?giorno=2027-05-04`)).text()), 1);
  assert.equal(count(await (await get(`/tornei/${t}?giorno=2027-05-03`)).text()), 2);
  assert.equal(count(await (await get(`/tornei/${t}?squadra=${f.p1}`)).text()), 2);
  const onA = (await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1 AND field_id = $2', [t, f['Palestra A']])).length;
  assert.equal(count(await (await get(`/tornei/${t}?campo=${f['Palestra A']}`)).text()), onA);
});

test('US-038: "Le mie partite" con campo, ora, avversario e arbitro, nel menu e in Home; finite e annullate escluse', async () => {
  assert.ok(menuFor({ roles: ['allievo'] }).some((i) => i.href === '/tornei/mie'));
  as('p2');
  const mine = await (await get('/tornei/mie')).text();
  assert.match(mine, /contro Team p[13]/);
  assert.match(mine, /campo: (Palestra A|Campo B)/);
  assert.match(mine, /Torneo visibile/);
  assert.doesNotMatch(mine, /contro Team p2/);
  const home = await (await get('/')).text();
  assert.match(home, /<h2>Le mie partite<\/h2>/);
  assert.match(home, /contro Team p[13]/);
  // chi non gioca né arbitra non vede la sezione in Home
  as('ext');
  assert.doesNotMatch(await (await get('/')).text(), /Le mie partite/);
  assert.match(await (await get('/tornei/mie')).text(), /Nessuna partita/);
  // le partite finite non compaiono più
  await pool.query(`UPDATE tournament_matches SET status = 'finita', home_score = 1, away_score = 0 WHERE tournament_id = $1`, [t]);
  as('p2');
  assert.match(await (await get('/tornei/mie')).text(), /Nessuna partita/);
  await pool.query(`UPDATE tournament_matches SET status = 'da giocare', home_score = NULL, away_score = NULL WHERE tournament_id = $1`, [t]);
});

test('US-038: l\'arbitro vede le partite che arbitra; le partite in corso sono evidenziate', async () => {
  await pool.query(`UPDATE tournament_matches SET referee_id = $2 WHERE tournament_id = $1`, [t, u.ref]);
  as('ref');
  assert.match(await (await get('/tornei/mie')).text(), /arbitri Team p\d – Team p\d/);
  const m = (await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 ORDER BY id LIMIT 1', [t]))[0];
  await pool.query(`UPDATE tournament_matches SET status = 'in corso' WHERE id = $1`, [m.id]);
  const page = await (await get(`/tornei/${t}`)).text();
  assert.match(page, /IN CORSO/);
  assert.match(page, /background:#ffd54f55/);
  assert.match(await (await get('/tornei/mie')).text(), /IN CORSO/);
});

test('US-038: vista a schermo intero per il proiettore: niente menu né moduli, testo grande', async () => {
  as('org');
  const normal = await (await get(`/tornei/${t}`)).text();
  assert.match(normal, /Gestisci il torneo/);
  assert.match(normal, /Schermo intero/);
  const screen = await (await get(`/tornei/${t}?schermo=1`)).text();
  assert.doesNotMatch(screen, /Gestisci il torneo|<form/);
  assert.match(screen, /body>header\{display:none\}/);
  assert.match(screen, /Classifiche e tabellone/);
  assert.match(screen, /EventSource/); // si aggiorna da sola
});

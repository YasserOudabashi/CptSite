import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { torneiRouter } from '../src/tornei/router';
import { generateCalendar } from '../src/tornei/calendar';
import { autoAssign } from '../src/tornei/schedule';
import { saveResult } from '../src/tornei/results';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let me = 0;
let roles: string[] = ['allievo'];
const u: Record<string, number> = {};
let t: number;
let old: number;
let oldDraft: number;
let oldYear: number;

const as = (n: string, r = ['allievo']) => {
  me = u[n];
  roles = r;
};
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;
const post = (path: string) => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  for (const n of ['org', 'ext', 'resp']) u[n] = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'T') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  oldYear = (await pool.query(`INSERT INTO school_years (name) VALUES ('2025-2026') RETURNING id`)).rows[0].id;
  t = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, max_teams, match_minutes) VALUES ($1,$2,'Calcio 2027','Calcio','iscrizioni','singoli',8,20) RETURNING id`, [y, u.org])).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [t, u.org]);
  await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2)', [t, 'Campo =1']);
  for (const n of ['Rossi', 'Blu', 'Verdi']) {
    const id = (await pool.query(`INSERT INTO tournament_teams (tournament_id, name, approved) VALUES ($1,$2,true) RETURNING id`, [t, n])).rows[0].id;
    const uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'G') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
    await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [id, t, uid]);
  }
  const org = { id: u.org, roles: ['allievo'] as never };
  await generateCalendar(pool, org, t, 2);
  await autoAssign(pool, org, t, '2027-05-03T09:00', 5);
  const m = (await q('SELECT id, home_id FROM tournament_matches WHERE tournament_id = $1 ORDER BY id LIMIT 1', [t]))[0];
  await saveResult(pool, org, t, m.id, { status: 'finita', home_score: '4', away_score: '2' });
  const scorer = (await q('SELECT user_id FROM tournament_members WHERE team_id = $1', [m.home_id]))[0].user_id;
  await pool.query(`INSERT INTO tournament_match_events (match_id, tournament_id, user_id, kind) VALUES ($1,$2,$3,'gol')`, [m.id, t, scorer]);
  // anno precedente: torneo concluso con squadre e partite + bozza
  old = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, rules, format, score_type, best_of, pts_win, status, max_teams) VALUES ($1,$2,'Volley 2026','Pallavolo','Regole volley','eliminazione','set',5,2,'concluso',8) RETURNING id`, [oldYear, u.org])).rows[0].id;
  oldDraft = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status) VALUES ($1,$2,'Bozza vecchia','X','bozza') RETURNING id`, [oldYear, u.org])).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2), ($3,$2)', [old, u.org, oldDraft]);
  await pool.query('INSERT INTO tournament_referees VALUES ($1,$2)', [old, u.ext]);
  await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2), ($1,$3)', [old, 'Palestra A', 'Palestra B']);
  await pool.query(`INSERT INTO tournament_teams (tournament_id, name) VALUES ($1,'Vecchia squadra')`, [old]);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: me, roles } as never;
    next();
  });
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

test('US-039: export CSV di squadre, calendario, risultati, classifiche, marcatori (solo gestori)', async () => {
  as('ext');
  assert.equal((await fetch(`${base}/tornei/${t}/export?what=squadre`)).status, 403);
  as('org');
  const csv = async (what: string) => {
    const r = await fetch(`${base}/tornei/${t}/export?what=${what}&fmt=csv`);
    assert.equal(r.status, 200, what);
    assert.match(r.headers.get('content-disposition') ?? '', new RegExp(`attachment; filename="Calcio_2027-${what}\\.csv"`));
    return r.text();
  };
  assert.match(await csv('squadre'), /^"Squadra";"Giocatori"/);
  assert.match(await csv('squadre'), /"Rossi";"Rossi G"/);
  const cal = await csv('calendario');
  assert.equal(cal.trim().split('\r\n').length, 4); // intestazione + 3 partite
  assert.match(cal, /"2027-05-03";"09:00";"Campo =1"/);
  assert.match(await csv('risultati'), /"4";"2";"";"finita"/);
  const cl = await csv('classifiche');
  assert.match(cl, /"Girone A";"1";"[A-Za-z]+";"1";"1";"0";"0";"4";"2";"2";"3"/);
  assert.match(await csv('marcatori'), /"[A-Za-z]+ G";"[A-Za-z]+";"1"/);
  assert.equal((await fetch(`${base}/tornei/${t}/export?what=boh`)).status, 400);
  // un'altra persona non organizzatrice, anche con altro ruolo base, no; il Responsabile tornei sì
  as('resp', ['resp_tornei']);
  assert.equal((await fetch(`${base}/tornei/${t}/export?what=squadre`)).status, 200);
});

test('US-039: export XLSX (zip valido) e formule neutralizzate nel CSV', async () => {
  as('org');
  const r = await fetch(`${base}/tornei/${t}/export?what=calendario&fmt=xlsx`);
  assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(buf.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  const csv = await (await fetch(`${base}/tornei/${t}/export?what=calendario&fmt=csv`)).text();
  assert.doesNotMatch(csv, /;"=1"/); // "Campo =1" non inizia con '=', ma un campo che inizia così verrebbe preceduto da '
  await pool.query(`UPDATE tournament_fields SET name = '=SOMMA(A1)' WHERE tournament_id = $1`, [t]);
  assert.match(await (await fetch(`${base}/tornei/${t}/export?what=calendario&fmt=csv`)).text(), /"'=SOMMA\(A1\)"/);
});

test('US-039: CSS di stampa sulla pagina del torneo (calendario e tabellone)', async () => {
  as('ext');
  const html = await (await fetch(`${base}/tornei/${t}`)).text();
  assert.match(html, /@media print\{[^<]*display:none/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /class="noprint"/);
});

test('US-039: archivio per anno scolastico, anni non mischiati, bozze solo ai gestori', async () => {
  as('ext');
  const arch = await (await fetch(`${base}/tornei/archivio`)).text();
  assert.match(arch, /Anno scolastico 2025-2026/);
  assert.match(arch, /Volley 2026/);
  assert.doesNotMatch(arch, /Calcio 2027|Bozza vecchia/);
  assert.doesNotMatch(await (await fetch(`${base}/tornei`)).text(), /Volley 2026/); // l'elenco corrente non mescola gli anni
  assert.equal((await fetch(`${base}/tornei/${old}`)).status, 200); // consultabile
  assert.doesNotMatch(arch, /Duplica/);
  as('org');
  assert.match(await (await fetch(`${base}/tornei/archivio`)).text(), /Bozza vecchia/);
  assert.match(await (await fetch(`${base}/tornei/archivio`)).text(), /Duplica/);
  void oldDraft;
});

test('US-039: duplica torneo dall\'anno precedente: regolamento, formato, punteggio, campi; senza squadre né partite', async () => {
  as('ext');
  await post(`/tornei/${old}/duplica`);
  assert.equal((await q('SELECT 1 FROM tournaments WHERE name = $1', ['Volley 2026'])).length, 1);
  as('org');
  await post(`/tornei/${t}/duplica`); // anno corrente: no
  assert.equal((await q('SELECT 1 FROM tournaments WHERE name = $1', ['Calcio 2027'])).length, 1);
  const r = await post(`/tornei/${old}/duplica`);
  assert.match(r.headers.get('location') ?? '', /gestione$/);
  const copies = await q('SELECT t.*, y.is_current FROM tournaments t JOIN school_years y ON y.id = t.school_year_id WHERE t.name = $1 ORDER BY t.id', ['Volley 2026']);
  assert.equal(copies.length, 2);
  const c = copies[1];
  assert.equal(c.is_current, true);
  assert.deepEqual([c.status, c.rules, c.format, c.score_type, c.best_of, c.pts_win, c.created_by], ['bozza', 'Regole volley', 'eliminazione', 'set', 5, 2, u.org]);
  assert.equal((await q('SELECT 1 FROM tournament_fields WHERE tournament_id = $1', [c.id])).length, 2);
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [c.id])).length, 0);
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1', [c.id])).length, 0);
  assert.equal((await q('SELECT 1 FROM tournament_referees WHERE tournament_id = $1', [c.id])).length, 0);
  assert.equal((await q('SELECT 1 FROM tournament_organizers WHERE tournament_id = $1 AND user_id = $2', [c.id, u.org])).length, 1);
  // l'originale è intatto
  assert.equal((await q('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [old])).length, 1);
  assert.equal((await q('SELECT 1 FROM tournament_fields WHERE tournament_id = $1', [old])).length, 2);
});

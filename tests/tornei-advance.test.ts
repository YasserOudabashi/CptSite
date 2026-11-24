import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { torneiRouter } from '../src/tornei/router';
import { generateCalendar } from '../src/tornei/calendar';
import { saveResult } from '../src/tornei/results';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let org = 0;
let y = 0;

const U = () => ({ id: org, roles: ['allievo'] as never });
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

async function mk(format: string, n: number, extra = ''): Promise<number> {
  const id = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, format, max_teams, groups_count, qualifiers ${extra ? ',' + extra.split('=')[0] : ''}) VALUES ($1,$2,'T','Calcio','iscrizioni','singoli',$3,32,2,1 ${extra ? ',' + extra.split('=')[1] : ''}) RETURNING id`, [y, org, format])).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [id, org]);
  for (let i = 1; i <= n; i++) {
    await pool.query(`INSERT INTO tournament_teams (tournament_id, name, approved, seed_no) VALUES ($1,$2,true,$3)`, [id, `S${i}`, i]);
  }
  await generateCalendar(pool, U(), id, 1);
  return id;
}
const play = (t: number, m: number, hs: number, as: number, extra: Record<string, string> = {}) =>
  saveResult(pool, U(), t, m, { status: 'finita', home_score: String(hs), away_score: String(as), ...extra });
const name = async (id: number | null) => (id ? (await q('SELECT name FROM tournament_teams WHERE id = $1', [id]))[0].name : null);

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  org = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('o@x.ch','O','O') RETURNING id`)).rows[0].id;
  y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.user = { id: org, roles: ['allievo'] } as never;
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

test('US-037: il vincitore avanza da solo; correggere il risultato aggiorna il turno dopo; bloccato se il turno dopo è iniziato', async () => {
  const t = await mk('eliminazione', 4); // teste di serie 1-4: semifinali S1-S4 e S2-S3
  const [s1, s2, fin] = await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, pos', [t]);
  assert.deepEqual([await name(s1.home_id), await name(s1.away_id)], ['S1', 'S4']);
  assert.equal(fin.home_id, null);
  await play(t, s1.id, 2, 0);
  assert.equal(await name((await q('SELECT home_id FROM tournament_matches WHERE id = $1', [fin.id]))[0].home_id), 'S1');
  await play(t, s2.id, 0, 1); // S3 batte S2: va nello slot ospite
  const f = (await q('SELECT * FROM tournament_matches WHERE id = $1', [fin.id]))[0];
  assert.deepEqual([await name(f.home_id), await name(f.away_id)], ['S1', 'S3']);
  // correzione: vince S2
  await play(t, s2.id, 3, 1);
  assert.equal(await name((await q('SELECT away_id FROM tournament_matches WHERE id = $1', [fin.id]))[0].away_id), 'S2');
  // se il risultato non è più "finita" la squadra esce dal turno dopo
  await saveResult(pool, U(), t, s2.id, { status: 'in corso', home_score: '1', away_score: '0' });
  assert.equal((await q('SELECT away_id FROM tournament_matches WHERE id = $1', [fin.id]))[0].away_id, null);
  await play(t, s2.id, 3, 1);
  // la finale inizia: le semifinali non si cambiano più
  await saveResult(pool, U(), t, fin.id, { status: 'in corso', home_score: '0', away_score: '0' });
  await assert.rejects(play(t, s1.id, 0, 5), /già iniziato/);
  assert.equal((await q('SELECT home_score FROM tournament_matches WHERE id = $1', [s1.id]))[0].home_score, 2);
  // stesso vincitore con altro punteggio: ammesso
  await play(t, s1.id, 4, 1);
  assert.equal((await q('SELECT home_score FROM tournament_matches WHERE id = $1', [s1.id]))[0].home_score, 4);
});

test('US-037: gironi + eliminazione, le qualificate entrano da sole a gironi conclusi', async () => {
  const t = await mk('gironi_eliminazione', 4); // 2 gironi da 2, 1 qualificata ciascuno -> finale
  const groups = await q('SELECT id FROM tournament_groups WHERE tournament_id = $1 ORDER BY id', [t]);
  const gm = await q(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND stage = 'girone' ORDER BY group_id`, [t]);
  const fin = (await q(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND stage = 'eliminazione'`, [t]))[0];
  assert.deepEqual([fin.home_src, fin.away_src], [`G${groups[0].id}:1`, `G${groups[1].id}:1`]);
  assert.equal(gm.length, 2);
  await play(t, gm[0].id, 1, 0); // vince la squadra di casa del girone A
  assert.equal((await q('SELECT home_id FROM tournament_matches WHERE id = $1', [fin.id]))[0].home_id, null); // girone B non finito
  await play(t, gm[1].id, 0, 2); // vince la squadra ospite del girone B
  const f = (await q('SELECT * FROM tournament_matches WHERE id = $1', [fin.id]))[0];
  assert.equal(f.home_id, gm[0].home_id);
  assert.equal(f.away_id, gm[1].away_id);
  // correzione del girone prima della finale: cambia la qualificata
  await play(t, gm[1].id, 3, 0);
  assert.equal((await q('SELECT away_id FROM tournament_matches WHERE id = $1', [fin.id]))[0].away_id, gm[1].home_id);
  // dopo l'inizio della finale i gironi sono bloccati
  await saveResult(pool, U(), t, fin.id, { status: 'in corso' });
  await assert.rejects(play(t, gm[1].id, 0, 3), /già iniziata/);
});

test('US-037: classifica e marcatori nella pagina del torneo', async () => {
  const t = await mk('girone', 3);
  const ms = await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY id', [t]);
  await play(t, ms[0].id, 2, 1);
  const uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('gol@x.ch','Gino','Gol') RETURNING id`)).rows[0].id;
  await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [ms[0].home_id, t, uid]);
  for (let i = 0; i < 2; i++) await pool.query(`INSERT INTO tournament_match_events (match_id, tournament_id, user_id, kind) VALUES ($1,$2,$3,'gol')`, [ms[0].id, t, uid]);
  await pool.query('UPDATE tournaments SET status = $2 WHERE id = $1', [t, 'in corso']);
  const html = await (await fetch(`${base}/tornei/${t}`)).text();
  assert.match(html, /Girone A/);
  assert.match(html, /<td>1<\/td><td>S\d<\/td><td>1<\/td><td>1<\/td><td>0<\/td><td>0<\/td><td>2<\/td><td>1<\/td><td>1<\/td><td><strong>3<\/strong>/); // 1° in classifica: 1 vinta, 2-1, 3 punti
  assert.match(html, /Gino Gol \(S\d\): 2/);
});

test('US-037: aggiornamento in tempo reale su tutte le pagine aperte', async () => {
  const t = await mk('girone', 3);
  const ms = await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 ORDER BY id', [t]);
  const ctl = new AbortController();
  const res = await fetch(`${base}/tornei/${t}/eventi`, { signal: ctl.signal });
  assert.ok(res.headers.get('content-type')!.startsWith('text/event-stream'));
  let got = 0;
  const reader = res.body!.getReader();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += (new TextDecoder().decode(value).match(/data: update/g) ?? []).length;
      }
    } catch {
      /* chiuso */
    }
  })();
  const waitFor = async (n: number) => {
    const start = Date.now();
    while (got < n) {
      if (Date.now() - start > 3000) assert.fail('nessun aggiornamento entro 3 secondi');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  await waitFor(1); // stato iniziale
  await play(t, ms[0].id, 1, 0);
  await waitFor(2);
  // un altro torneo non disturba
  const other = await mk('girone', 3);
  const before_ = got;
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(got, before_);
  void other;
  ctl.abort();
});

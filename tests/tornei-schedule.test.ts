import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { torneiRouter } from '../src/tornei/router';
import { autoSchedule, findConflict, type Slot } from '../src/tornei/schedule';
import { roundRobin } from '../src/tornei/plan';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let org = 0;
let t: number;
let teams: number[] = [];
let refs: number[] = [];
let fields: number[] = [];
let matches: { id: number; home_id: number; away_id: number }[] = [];

const post = (path: string, body: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

test('autoSchedule: nessuna squadra due volte nello stesso orario, un solo arbitro per orario, tanti campi quanti ne servono', () => {
  const rr = roundRobin([1, 2, 3, 4, 5, 6], false).map((m, i) => ({ id: i + 1, stage: 'girone', round: m.round, pos: i, home: m.home, away: m.away }));
  for (const fieldCount of [1, 2, 3]) {
    const plan = autoSchedule(rr, fieldCount, [10, 11], 30, 10);
    assert.equal(plan.length, 15);
    const slots: Slot[] = plan.map((p) => {
      const m = rr.find((x) => x.id === p.id)!;
      return { id: p.id, field: p.field, start: p.offset * 60000, home: m.home, away: m.away, referee: p.referee };
    });
    for (const s of slots) assert.equal(findConflict(slots, s, 30), null);
    // gli orari sono multipli di durata + pausa
    assert.ok(plan.every((p) => p.offset % 40 === 0));
    assert.equal(Math.max(...plan.map((p) => p.offset)) / 40 + 1, fieldCount === 1 ? 15 : fieldCount === 2 ? 10 : 5);
  }
});

test('autoSchedule: i turni a eliminazione vengono dopo i gironi e in ordine', () => {
  const ms = [
    { id: 1, stage: 'eliminazione', round: 2, pos: 1, home: null, away: null },
    { id: 2, stage: 'eliminazione', round: 1, pos: 1, home: 1, away: 2 },
    { id: 3, stage: 'girone', round: 1, pos: 1, home: 1, away: 2 },
  ];
  const off = (id: number) => autoSchedule(ms, 4, [], 20, 0).find((p) => p.id === id)!.offset;
  assert.ok(off(3) < off(2) && off(2) < off(1));
});

test('findConflict: campo, squadra, arbitro in orari che si sovrappongono; orari adiacenti sono ok', () => {
  const a: Slot = { id: 1, field: 1, start: 0, home: 1, away: 2, referee: 9 };
  const min = 30;
  const at = (start: number, o: Partial<Slot>): Slot => ({ id: 2, field: 5, start, home: 7, away: 8, referee: null, ...o });
  assert.match(findConflict([a], at(10 * 60000, { field: 1 }), min)!, /campo/);
  assert.match(findConflict([a], at(29 * 60000, { home: 2 }), min)!, /squadra/);
  assert.match(findConflict([a], at(15 * 60000, { referee: 9 }), min)!, /arbitro/);
  assert.equal(findConflict([a], at(30 * 60000, { field: 1, home: 1, referee: 9 }), min), null);
  assert.equal(findConflict([a], at(10 * 60000, {}), min), null);
  assert.equal(findConflict([a], { ...a, start: 0 }, min), null); // se stessa non confligge con sé stessa
});

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const user = async (n: string) => (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'T') RETURNING id`, [`${n}@x.ch`, n])).rows[0].id;
  org = await user('org');
  refs = [await user('arb1'), await user('arb2')];
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  t = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, max_teams, match_minutes) VALUES ($1,$2,'T','Calcio','iscrizioni','singoli',8,30) RETURNING id`, [y, org])).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [t, org]);
  for (const r of refs) await pool.query('INSERT INTO tournament_referees VALUES ($1,$2)', [t, r]);
  for (const n of ['A', 'B', 'C', 'D']) {
    const tid = (await pool.query(`INSERT INTO tournament_teams (tournament_id, name, approved) VALUES ($1,$2,true) RETURNING id`, [t, n])).rows[0].id;
    teams.push(tid);
    const uid = await user(`g${n}`);
    await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [tid, t, uid]);
  }
  for (const n of ['Palestra A', 'Campo B']) fields.push((await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2) RETURNING id', [t, n])).rows[0].id);
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

test('US-035: assegnazione automatica da data/ora (ora di Zurigo) con 2 campi', async () => {
  // prima del calendario: rifiutata
  await post(`/tornei/${t}/programma/auto`, { start: '2027-04-21T09:00', pause: '10' });
  await pool.query(`UPDATE tournaments SET status = 'iscrizioni'`);
  await post(`/tornei/${t}/calendario`, { seed: '3' });
  await post(`/tornei/${t}/programma/auto`, { start: '2027-04-21T09:00', pause: '10' });
  matches = await q('SELECT id, home_id, away_id, field_id, referee_id, starts_at FROM tournament_matches WHERE tournament_id = $1 ORDER BY starts_at, id', [t]);
  assert.equal(matches.length, 6);
  const first = (matches as unknown as { starts_at: Date }[])[0].starts_at;
  assert.equal(first.toISOString(), '2027-04-21T07:00:00.000Z'); // 09:00 a Zurigo (CEST, UTC+2)
  const rows = await q(`SELECT to_char(starts_at AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS h FROM tournament_matches WHERE tournament_id = $1`, [t]);
  assert.deepEqual([...new Set(rows.map((r) => r.h))].sort(), ['09:00', '09:40', '10:20']);
  assert.ok(matches.every((m) => (m as unknown as { field_id: number }).field_id));
});

test('US-035: modifica manuale bloccata se campo, squadra o arbitro sono già occupati', async () => {
  const [m1, m2] = await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY starts_at, id', [t]);
  const edit = (m: { id: number }, b: Record<string, string>) => post(`/tornei/${t}/partite/${m.id}/orario`, b);
  // m2 sullo stesso campo e orario di m1
  await edit(m2, { field: String(m1.field_id), start: '2027-04-21T09:10', referee: '', reason: 'x' });
  assert.notEqual((await q('SELECT field_id FROM tournament_matches WHERE id = $1', [m2.id]))[0].field_id, null);
  const after1 = (await q('SELECT field_id, starts_at FROM tournament_matches WHERE id = $1', [m2.id]))[0];
  assert.ok(!(after1.field_id === m1.field_id && after1.starts_at.getTime() === m1.starts_at.getTime() + 10 * 60000));
  // un'altra partita della stessa squadra nello stesso orario di m1
  const other = (await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 AND id <> $2 AND (home_id IN ($3,$4) OR away_id IN ($3,$4)) AND starts_at <> $5 LIMIT 1', [t, m1.id, m1.home_id, m1.away_id, m1.starts_at]))[0];
  await edit(other, { field: '', start: '2027-04-21T09:15', referee: '', reason: 'spostata' });
  assert.notEqual((await q('SELECT starts_at FROM tournament_matches WHERE id = $1', [other.id]))[0].starts_at.getTime(), new Date('2027-04-21T07:15:00Z').getTime());
  // arbitro occupato: stesso arbitro di m1 nello stesso orario
  const free = (await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 AND home_id NOT IN ($2,$3) AND away_id NOT IN ($2,$3) LIMIT 1', [t, m1.home_id, m1.away_id]))[0];
  if (free && m1.referee_id) {
    await edit(free, { field: '', start: '2027-04-21T09:10', referee: String(m1.referee_id), reason: 'x' });
    const r = (await q('SELECT referee_id, starts_at FROM tournament_matches WHERE id = $1', [free.id]))[0];
    assert.ok(!(r.referee_id === m1.referee_id && r.starts_at.getTime() === m1.starts_at.getTime() + 10 * 60000));
  }
});

test('US-035: spostare una partita già programmata richiede il motivo, che la squadra vede', async () => {
  const [m] = await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY id DESC LIMIT 1', [t]);
  await pool.query('UPDATE tournament_matches SET field_id = NULL, referee_id = NULL WHERE id = $1', [m.id]);
  await post(`/tornei/${t}/partite/${m.id}/orario`, { field: '', start: '2027-04-22T14:00', referee: '', reason: '' });
  assert.notEqual((await q('SELECT starts_at FROM tournament_matches WHERE id = $1', [m.id]))[0].starts_at.toISOString(), '2027-04-22T12:00:00.000Z');
  await post(`/tornei/${t}/partite/${m.id}/orario`, { field: '', start: '2027-04-22T14:00', referee: '', reason: 'Pioggia' });
  const r = (await q('SELECT starts_at, postponed_reason FROM tournament_matches WHERE id = $1', [m.id]))[0];
  assert.equal(r.starts_at.toISOString(), '2027-04-22T12:00:00.000Z');
  assert.equal(r.postponed_reason, 'Pioggia');
  assert.match(await (await fetch(`${base}/tornei/${t}`)).text(), /rinviata: Pioggia/);
});

test('US-035: avviso (non blocco) se un giocatore ha un\'attività GA nello stesso orario', async () => {
  const [m] = await q('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY id LIMIT 1', [t]);
  const y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1,'2027-04-21') RETURNING id`, [y])).rows[0].id;
  const b1 = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position LIMIT 1`)).rows[0].id; // 08:30-10:00
  const act = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'Scacchi',$2,'approvata',5) RETURNING id`, [y, org])).rows[0].id;
  const sess = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [act, day, b1])).rows[0].id;
  const member = (await q('SELECT user_id FROM tournament_members WHERE team_id = $1', [m.home_id]))[0].user_id;
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [member, sess]);
  const res = await post(`/tornei/${t}/partite/${m.id}/orario`, { field: String(m.field_id ?? ''), start: '2027-04-21T09:00', referee: '', reason: 'spostamento' });
  assert.equal(res.status, 303);
  assert.equal((await q('SELECT starts_at FROM tournament_matches WHERE id = $1', [m.id]))[0].starts_at.toISOString(), '2027-04-21T07:00:00.000Z'); // salvata comunque
  assert.match(await (await fetch(`${base}/tornei/${t}/programma`)).text(), /Attenzione: .*Scacchi/);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { generateCalendar } from '../src/tornei/calendar';
import { autoAssign, editMatch } from '../src/tornei/schedule';
import { saveResult } from '../src/tornei/results';
import { buildPlan } from '../src/tornei/plan';
import { parseTournament, removePerson, updateTournament } from '../src/tornei/service';
import { myMatches, myMatchesHtml } from '../src/tornei/mine';
import { toCsv } from '../src/ga/exports';
import { openEnrollment } from '../src/ga/enroll';

let pool: Pool;
let stopDb: () => Promise<void>;
let org = 0;
let y = 0;
const U = () => ({ id: org, roles: ['allievo'] as never });
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

async function mk(format: string, n: number, extra: Record<string, string | number> = {}): Promise<number> {
  const cols = Object.keys(extra);
  const id = (await pool.query(
    `INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, format, max_teams ${cols.map((c) => ',' + c).join('')})
     VALUES ($1,$2,'T','Calcio','iscrizioni','singoli',$3,32 ${cols.map((_, i) => `,$${i + 4}`).join('')}) RETURNING id`,
    [y, org, format, ...cols.map((c) => extra[c])],
  )).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [id, org]);
  for (let i = 1; i <= n; i++) await pool.query(`INSERT INTO tournament_teams (tournament_id, name, approved) VALUES ($1,$2,true)`, [id, `S${i}`]);
  await generateCalendar(pool, U(), id, 1);
  return id;
}

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  org = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('o@x.ch','O','O') RETURNING id`)).rows[0].id;
  y = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
});
after(async () => stopDb());

test('1: in eliminazione una partita non si annulla; nel girone sì', async () => {
  const k = await mk('eliminazione', 4);
  const m = (await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 ORDER BY id LIMIT 1', [k]))[0];
  await assert.rejects(saveResult(pool, U(), k, m.id, { status: 'annullata' }), /forfait/);
  const g = await mk('girone', 3);
  const gm = (await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 ORDER BY id LIMIT 1', [g]))[0];
  await saveResult(pool, U(), g, gm.id, { status: 'annullata' });
  assert.equal((await q('SELECT status FROM tournament_matches WHERE id = $1', [gm.id]))[0].status, 'annullata');
});

test('2: "punti" è sempre il primo criterio, "sorteggio" l\'ultimo', () => {
  const base = { name: 'a', sport: 'b', mode: 'singoli', groups_count: '1', qualifiers: '1', pts_win: '3', pts_draw: '1', pts_loss: '0', forfeit_score: '3', match_minutes: '30', max_teams: '8' };
  assert.equal(parseTournament({ ...base, tiebreaks: '' }).tiebreaks, 'punti,sorteggio');
  assert.equal(parseTournament({ ...base, tiebreaks: 'differenza,punti,fatti' }).tiebreaks, 'punti,differenza,fatti,sorteggio');
  assert.equal(parseTournament({ ...base, tiebreaks: 'sorteggio,differenza' }).tiebreaks, 'punti,differenza,sorteggio');
  assert.throws(() => parseTournament({ ...base, forfeit_score: '0', tiebreaks: '' }), /forfait/);
});

test('3: eventi e membri notificano il tempo reale', async () => {
  const t = await mk('girone', 2);
  const client = await pool.connect();
  const got: string[] = [];
  client.on('notification', (n) => got.push(String(n.payload)));
  await client.query('LISTEN tornei_live');
  const uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('m@x.ch','M','M') RETURNING id`)).rows[0].id;
  const team = (await q('SELECT id FROM tournament_teams WHERE tournament_id = $1 LIMIT 1', [t]))[0].id;
  await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [team, t, uid]);
  const m = (await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 LIMIT 1', [t]))[0];
  await new Promise((r) => setTimeout(r, 200));
  const afterMember = got.length;
  assert.ok(afterMember >= 1);
  await pool.query(`INSERT INTO tournament_match_events (match_id, tournament_id, user_id, kind) VALUES ($1,$2,$3,'gol')`, [m.id, t, uid]);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(got.length > afterMember);
  assert.ok(got.every((p) => p === String(t)));
  client.release(true);
});

test('4: autoAssign tocca solo le partite non programmate, rispetta i campi occupati e non cancella i rinvii', async () => {
  const t = await mk('girone', 3, { match_minutes: 30 });
  await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2)', [t, 'Unico']);
  await pool.query(`UPDATE tournaments SET status = 'in corso' WHERE id = $1`, [t]);
  await autoAssign(pool, U(), t, '2027-05-03T09:00', 10);
  const hours = async () => (await q(`SELECT id, to_char(starts_at AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS h, postponed_reason AS r FROM tournament_matches WHERE tournament_id = $1 ORDER BY starts_at`, [t]));
  const first = await hours();
  assert.deepEqual(first.map((x) => x.h), ['09:00', '09:40', '10:20']);
  // rinvio della terza partita
  await editMatch(pool, U(), t, first[2].id, { start: '2027-05-03T14:00', reason: 'Pioggia' });
  // seconda volta: nulla da assegnare, tutto invariato (anche il motivo del rinvio)
  await autoAssign(pool, U(), t, '2027-05-04T08:00', 10);
  assert.deepEqual((await hours()).map((x) => [x.h, x.r]), [['09:00', null], ['09:40', null], ['14:00', 'Pioggia']]);
  // la prima è in corso, la seconda e la terza si riprogrammano: non devono sovrapporsi al campo occupato
  await pool.query(`UPDATE tournament_matches SET status = 'in corso' WHERE id = $1`, [first[0].id]);
  await pool.query(`UPDATE tournament_matches SET starts_at = NULL, postponed_reason = NULL WHERE id IN ($1,$2)`, [first[1].id, first[2].id]);
  await autoAssign(pool, U(), t, '2027-05-03T09:00', 10);
  const now = await hours();
  assert.equal(now.find((x) => x.id === first[0].id)!.h, '09:00');
  const others = now.filter((x) => x.id !== first[0].id).map((x) => x.h);
  assert.deepEqual(others, ['09:40', '10:20']);
});

test('4: "Le mie partite" mostra il motivo del rinvio', async () => {
  const t = await mk('girone', 2);
  const uid = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('gg@x.ch','G','G') RETURNING id`)).rows[0].id;
  const team = (await q('SELECT id FROM tournament_teams WHERE tournament_id = $1 LIMIT 1', [t]))[0].id;
  await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [team, t, uid]);
  await pool.query(`UPDATE tournament_matches SET postponed_reason = 'Palestra chiusa', starts_at = now() WHERE tournament_id = $1`, [t]);
  await pool.query(`UPDATE tournaments SET status = 'in corso' WHERE id = $1`, [t]);
  assert.match(myMatchesHtml(await myMatches(pool, uid)), /rinviata: Palestra chiusa/);
});

test('5: forfait almeno 1; a set vale i set necessari a vincere', async () => {
  await assert.rejects(pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, forfeit_score) VALUES ($1,$2,'x','y',0)`, [y, org]));
  const t = await mk('girone', 2, { score_type: 'set', best_of: 5 });
  await pool.query(`UPDATE tournaments SET status = 'in corso' WHERE id = $1`, [t]);
  const m = (await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 LIMIT 1', [t]))[0];
  await saveResult(pool, U(), t, m.id, { status: 'finita', forfeit: 'away' });
  const r = (await q('SELECT home_score, away_score, forfeit FROM tournament_matches WHERE id = $1', [m.id]))[0];
  assert.deepEqual([r.home_score, r.away_score, r.forfeit], [0, 3, true]);
});

test('6: togliere un arbitro lo toglie dalle partite', async () => {
  const t = await mk('girone', 3);
  const ref = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('r@x.ch','R','R') RETURNING id`)).rows[0].id;
  await pool.query('INSERT INTO tournament_referees VALUES ($1,$2)', [t, ref]);
  await pool.query('UPDATE tournament_matches SET referee_id = $2 WHERE tournament_id = $1', [t, ref]);
  await removePerson(pool, U(), t, 'referees', ref);
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1 AND referee_id IS NOT NULL', [t])).length, 0);
});

test('7: con le iscrizioni aperte non si tolgono posti a chi è già iscritto', async () => {
  const t = (await pool.query(`INSERT INTO tournaments (school_year_id, created_by, name, sport, status, mode, team_min, team_max, max_teams) VALUES ($1,$2,'N','Y','iscrizioni','squadre',1,3,8) RETURNING id`, [y, org])).rows[0].id;
  await pool.query('INSERT INTO tournament_organizers VALUES ($1,$2)', [t, org]);
  const form = { name: 'N', sport: 'Y', mode: 'squadre', team_min: '1', team_max: '3', format: 'girone', groups_count: '1', qualifiers: '1', score_type: 'punti', best_of: '3', pts_win: '3', pts_draw: '1', pts_loss: '0', forfeit_score: '3', match_minutes: '30', max_teams: '8', tiebreaks: '' };
  for (const n of ['A', 'B', 'C']) await pool.query(`INSERT INTO tournament_teams (tournament_id, name) VALUES ($1,$2)`, [t, n]);
  const team = (await q('SELECT id FROM tournament_teams WHERE tournament_id = $1 LIMIT 1', [t]))[0].id;
  for (let i = 0; i < 3; i++) {
    const u = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,'P','P') RETURNING id`, [`p${i}@x.ch`])).rows[0].id;
    await pool.query('INSERT INTO tournament_members (team_id, tournament_id, user_id, confirmed) VALUES ($1,$2,$3,true)', [team, t, u]);
  }
  await assert.rejects(updateTournament(pool, U(), t, { ...form, max_teams: '2' }), /già 3 iscritti/);
  await assert.rejects(updateTournament(pool, U(), t, { ...form, team_max: '2' }), /già 3 giocatori/);
  await assert.rejects(updateTournament(pool, U(), t, { ...form, mode: 'singoli' }), /modalità/);
  await updateTournament(pool, U(), t, { ...form, max_teams: '3', team_max: '3' });
  assert.equal((await q('SELECT max_teams FROM tournaments WHERE id = $1', [t]))[0].max_teams, 3);
});

test('8: qualificate non potenza di 2: niente accoppiamenti dello stesso girone al primo turno, altrimenti avviso', () => {
  const T = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, seed_no: null }));
  const p = buildPlan({ format: 'gironi_eliminazione', double_round: false, groups_count: 3, qualifiers: 2 }, T(12), 5);
  const first = p.matches.filter((m) => m.stage === 'eliminazione' && m.round === 1 && m.homeSrc && m.awaySrc);
  assert.ok(first.length >= 2);
  for (const m of first) assert.notEqual(m.homeSrc!.split(':')[0], m.awaySrc!.split(':')[0]);
  assert.equal(p.warnings.length, 0);
  // un solo girone con 3 qualificate: impossibile evitarlo
  const one = buildPlan({ format: 'gironi_eliminazione', double_round: false, groups_count: 1, qualifiers: 3 }, T(4), 5);
  assert.equal(one.warnings.length, 1);
});

test('9: due modifiche simultanee dello stesso campo e orario: ne passa una sola', async () => {
  const t = await mk('girone', 4);
  await pool.query(`UPDATE tournaments SET status = 'in corso' WHERE id = $1`, [t]);
  const f = (await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2) RETURNING id', [t, 'C'])).rows[0].id;
  const ms = await q('SELECT id FROM tournament_matches WHERE tournament_id = $1 ORDER BY id', [t]);
  const res = await Promise.allSettled([0, 1, 2, 3].map((i) => editMatch(pool, U(), t, ms[i].id, { field: String(f), start: '2027-05-03T10:00' })));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await q('SELECT 1 FROM tournament_matches WHERE tournament_id = $1 AND field_id = $2', [t, f])).length, 1);
});

test('10: CSV, i numeri puri non prendono l\'apice, le formule sì', () => {
  const csv = toCsv([['-5', '12', '=1+1', '-x', '+3', '@a', '-1.5']]);
  assert.match(csv, /"-5";"12";"'=1\+1";"'-x";"'\+3";"'@a";"'-1\.5"/);
});

test('11: la mail di apertura non parte due volte se due Responsabili premono insieme', async () => {
  const r = await Promise.allSettled([openEnrollment(pool, org, false), openEnrollment(pool, org, false), openEnrollment(pool, org, false)]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await q(`SELECT 1 FROM mail_jobs WHERE kind = 'enrollment_open'`)).length, 1);
  assert.match(String((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason), /già stata inviata/);
  // con la conferma esplicita si può reinviare
  await openEnrollment(pool, org, true);
  assert.equal((await q(`SELECT 1 FROM mail_jobs WHERE kind = 'enrollment_open'`)).length, 2);
});

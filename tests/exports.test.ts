import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';
import { toXlsx } from '../src/ga/exports';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let roles: string[] = ['resp_ga'];
const ids: Record<string, number> = {};

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const y1 = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const y0 = (await pool.query(`INSERT INTO school_years (name) VALUES ('2025-2026') RETURNING id`)).rows[0].id;
  const mkDay = async (y: number, d: string) => (await pool.query('INSERT INTO ga_days (school_year_id, day) VALUES ($1,$2) RETURNING id', [y, d])).rows[0].id;
  const [d1, d0] = [await mkDay(y1, '2027-04-21'), await mkDay(y0, '2026-04-22')];
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const user = async (l: string, first: string, last: string, role: string, cls: string | null, pw: string | null = 'h') => {
    const id = (await pool.query(`INSERT INTO users (login_id, first_name, last_name, class_name, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [l, first, last, cls, pw])).rows[0].id;
    await pool.query('INSERT INTO user_roles VALUES ($1,$2)', [id, role]);
    return id as number;
  };
  const rel = await user('rel@x.ch', 'Zoë', 'Müller', 'relatore', null);
  const stu = await user('s1@x.ch', 'Ada', 'Rossi', 'allievo', 'I3A');
  const stu2 = await user('s2@x.ch', 'Bea', 'Bianchi', 'allievo', 'I4B');
  const act = async (t: string, org: number, y: number, d: number, blk: number) => {
    const a = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,$2,$3,'approvata',9) RETURNING id`, [y, t, org])).rows[0].id;
    ids[t] = a;
    return (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id, block_count) VALUES ($1,$2,$3,1) RETURNING id`, [a, d, b[blk]])).rows[0].id as number;
  };
  const caffe = await act('Caffè letterario', rel, y1, d1, 0);
  const calcio = await act('Calcio', stu, y1, d1, 1);
  const vecchia = await act('Vecchia attività', rel, y0, d0, 0);
  await pool.query('INSERT INTO enrollments (user_id, session_id, present) VALUES ($1,$2,true), ($3,$2,false), ($1,$4,null)', [stu, caffe, stu2, calcio]);
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [stu2, vecchia]);
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 1, roles } as never;
    next();
  });
  app.use(gaRouter(pool));
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

const csv = async (q: string) => {
  const r = await fetch(`${base}/gestione-ga/export?fmt=csv&${q}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type')!, /text\/csv; charset=utf-8/);
  return r.text();
};

test('CSV con BOM UTF-8 e accenti; solo l\'anno corrente', async () => {
  const t = await csv('what=attivita');
  const raw = Buffer.from(await (await fetch(`${base}/gestione-ga/export?what=attivita&fmt=csv`)).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM (text() lo toglie)
  assert.match(t, /"Caffè letterario";"approvata";"Zoë Müller";"relatore"/);
  assert.doesNotMatch(t, /Vecchia attività/);
});

test('filtri: per tipo di organizzatore e per attività scelte', async () => {
  const onlyStudents = await csv('what=attivita&kind=allievo');
  assert.match(onlyStudents, /Calcio/);
  assert.doesNotMatch(onlyStudents, /Caffè/);
  const chosen = await csv(`what=presenze&ids=${ids['Caffè letterario']}`);
  assert.match(chosen, /"Rossi";"Ada";"I3A";"presente"/);
  assert.match(chosen, /"Bianchi";"Bea";"I4B";"assente"/);
  assert.doesNotMatch(chosen, /Calcio/);
  assert.match(await csv('what=presenze'), /"non segnata"/);
});

test('allievi con classe e programma; filtro per classe', async () => {
  const t = await csv('what=allievi');
  assert.match(t, /"Rossi";"Ada";"s1@x\.ch";"I3A";"21\.04 Blocco 1: Caffè letterario; 21\.04 Blocco 2: Calcio"/);
  assert.match(await csv('what=allievi&classe=I4B'), /Bianchi/);
  assert.doesNotMatch(await csv('what=allievi&classe=I4B'), /Rossi/);
});

test('relatori e docenti', async () => {
  assert.match(await csv('what=relatori'), /"Zoë Müller";"rel@x\.ch";"";"Caffè letterario"/);
  assert.equal((await csv('what=docenti')).trim().split('\r\n').length, 1); // solo intestazione
});

test('anno scelto: solo dati di quell\'anno', async () => {
  const y0 = (await pool.query(`SELECT id FROM school_years WHERE name = '2025-2026'`)).rows[0].id;
  const t = await csv(`what=attivita&anno=${y0}`);
  assert.match(t, /Vecchia attività/);
  assert.doesNotMatch(t, /Caffè/);
});

test('XLSX valido: file zip con CRC corretti e il testo con gli accenti', async () => {
  const r = await fetch(`${base}/gestione-ga/export?what=attivita&fmt=xlsx`);
  assert.match(r.headers.get('content-type')!, /spreadsheetml\.sheet/);
  const buf = Buffer.from(await r.arrayBuffer());
  const names: string[] = [];
  let sheet = '';
  for (let o = 0; buf.readUInt32LE(o) === 0x04034b50; ) {
    const size = buf.readUInt32LE(o + 18);
    const nl = buf.readUInt16LE(o + 26);
    const name = buf.subarray(o + 30, o + 30 + nl).toString();
    const data = buf.subarray(o + 30 + nl, o + 30 + nl + size);
    assert.equal(buf.readUInt32LE(o + 14), crc32(data), name);
    names.push(name);
    if (name.endsWith('sheet1.xml')) sheet = data.toString();
    o += 30 + nl + size;
  }
  assert.ok(names.includes('[Content_Types].xml') && names.includes('xl/workbook.xml'));
  assert.match(sheet, /Caffè letterario/);
  assert.match(toXlsx([['a&b']]).toString('latin1'), /a&amp;b/);
});

test('solo il Responsabile GA esporta', async () => {
  roles = ['allievo'];
  assert.equal((await fetch(`${base}/gestione-ga/export?what=attivita`)).status, 403);
  roles = ['resp_ga'];
  assert.equal((await fetch(`${base}/gestione-ga/export?what=boh`)).status, 400);
});

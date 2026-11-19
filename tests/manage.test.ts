import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import { gaRouter } from '../src/ga/router';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: import('node:http').Server;
let base: string;
let roles: string[] = ['resp_ga'];

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query(`INSERT INTO ga_days (school_year_id, day) VALUES ($1,'2027-04-21') RETURNING id`, [year])).rows[0].id;
  const b = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position`)).rows.map((r) => r.id);
  const room = (await pool.query(`INSERT INTO rooms (name) VALUES ('Palestra') RETURNING id`)).rows[0].id;
  const mk = async (l: string, first: string, role: string) => {
    const id = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ($1,$2,'Verdi') RETURNING id`, [l, first])).rows[0].id;
    await pool.query('INSERT INTO user_roles VALUES ($1,$2)', [id, role]);
    return id as number;
  };
  const rel = await mk('rel@x.ch', 'Rita', 'relatore');
  const doc = await mk('doc@x.ch', 'Dino', 'docente');
  await mk('nuovo@x.ch', 'Nessuno', 'relatore'); // relatore senza attività nell'anno: non compare
  const all = await mk('al@x.ch', 'Ale', 'allievo');
  const act = async (t: string, org: number, min: number, blk: number, status = 'approvata') => {
    const a = (await pool.query(`INSERT INTO activities (school_year_id, title, organizer_id, contact, room_id, status, min_participants, max_participants) VALUES ($1,$2,$3,'091 555',$4,$5,$6,10) RETURNING id`, [year, t, org, room, status, min])).rows[0].id;
    return (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [a, day, b[blk]])).rows[0].id as number;
  };
  const s1 = await act('Poche adesioni', rel, 5, 0);
  await act('Piena', doc, 1, 1);
  await act('Solo proposta', rel, 0, 2, 'proposta');
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1,$2)', [all, s1]);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
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

test('tabella attività con blocco, aula, iscritti/max e organizzatore; sotto il minimo segnalato', async () => {
  const html = await (await fetch(`${base}/gestione-ga`)).text();
  assert.match(html, /Poche adesioni<\/a><\/td><td>approvata<\/td><td>Blocco 1 21\.04<\/td><td>Palestra<\/td><td>1\/10 <strong>sotto il minimo \(5\)/);
  assert.match(html, /Rita Verdi/);
  assert.match(html, /Solo proposta/);
  assert.equal(html.split('sotto il minimo').length - 1, 2); // anche "Piena" (minimo 1, zero iscritti); la proposta non conta
});

test('anagrafica relatori e docenti dell\'anno, con contatto e attività', async () => {
  const html = await (await fetch(`${base}/gestione-ga`)).text();
  assert.match(html, /Rita Verdi<\/td><td>rel@x\.ch · 091 555<\/td><td>Poche adesioni, Solo proposta/);
  assert.match(html, /Dino Verdi<\/td><td>doc@x\.ch/);
  assert.doesNotMatch(html, /Nessuno Verdi/);
});

test('accesso: Responsabile GA e Responsabile sito sì, gli altri no', async () => {
  roles = ['resp_sito'];
  assert.equal((await fetch(`${base}/gestione-ga`)).status, 200);
  for (const r of ['allievo', 'docente', 'relatore']) {
    roles = [r];
    assert.equal((await fetch(`${base}/gestione-ga`)).status, 403, r);
  }
  roles = ['resp_ga'];
});

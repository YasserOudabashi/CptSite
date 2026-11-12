import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db';
import { layoutMiddleware, menuFor } from '../src/ui/layout';
import { homeRouter } from '../src/ui/home';
import type { RoleCode } from '../src/users/roles';

let pool: Pool;
let stopDb: () => Promise<void>;
let server: Server;
let base: string;
let roles: RoleCode[] | null = null;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const app = express();
  app.use((req, _res, next) => {
    if (roles) req.user = { id: 1, roles };
    next();
  });
  app.use(layoutMiddleware(pool));
  app.use(homeRouter());
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

const labels = (r: RoleCode[] | undefined) => menuFor(r ? { roles: r } : undefined).map((i) => i.label);

test('ospite: solo Accedi e Registrati', () => {
  assert.deepEqual(labels(undefined), ['Accedi', 'Registrati']);
});

test('allievo: nessuna voce di gestione o amministrazione', () => {
  const l = labels(['allievo']);
  assert.ok(l.includes('Il mio programma'));
  assert.ok(!l.includes('Gestione GA'));
  assert.ok(!l.includes('Utenti'));
});

test('resp_ga vede Gestione GA ma non Utenti; due ruoli = unione', () => {
  assert.ok(labels(['resp_ga']).includes('Gestione GA'));
  assert.ok(!labels(['resp_ga']).includes('Utenti'));
  const l = labels(['relatore', 'resp_ga']);
  assert.ok(l.includes('Proponi attività') && l.includes('Gestione GA'));
});

test('resp_sito vede tutte le voci', () => {
  assert.ok(labels(['resp_sito']).includes('Impostazioni'));
  assert.ok(labels(['resp_sito']).includes('Gestione GA'));
});

test('la Home ha nome del sito, anno corrente, menu che va a capo e tema chiaro/scuro', async () => {
  roles = ['resp_ga'];
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Portale CPT Trevano/);
  assert.match(html, /anno scolastico 2026-2027/);
  assert.match(html, /Gestione GA/);
  assert.match(html, /flex-wrap:wrap/);
  assert.match(html, /color-scheme:light dark/);
  assert.match(html, /action="\/logout"/);
});

test('ospite sulla Home: menu di accesso, nessun Esci', async () => {
  roles = null;
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Registrati/);
  assert.doesNotMatch(html, /Esci/);
});

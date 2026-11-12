import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { can, requireCan } from '../src/auth/permissions';
import type { RoleCode } from '../src/users/roles';

const u = (...roles: RoleCode[]) => ({ roles });

test('allievo: si iscrive, non gestisce', () => {
  assert.equal(can(u('allievo'), 'ga.enroll'), true);
  assert.equal(can(u('allievo'), 'ga.manage'), false);
});

test('docente: vota, non approva', () => {
  assert.equal(can(u('docente'), 'poll.vote'), true);
  assert.equal(can(u('docente'), 'ga.approve'), false);
});

test('relatore: propone, non si iscrive', () => {
  assert.equal(can(u('relatore'), 'ga.propose'), true);
  assert.equal(can(u('relatore'), 'ga.enroll'), false);
});

test('resp_ga: gestisce e approva, non amministra il sito', () => {
  assert.equal(can(u('resp_ga'), 'ga.approve'), true);
  assert.equal(can(u('resp_ga'), 'ga.attendance.all'), true);
  assert.equal(can(u('resp_ga'), 'admin.users'), false);
});

test('resp_sito: ogni azione', () => {
  for (const a of ['ga.enroll', 'ga.approve', 'admin.users', 'admin.settings', 'poll.create'] as const) {
    assert.equal(can(u('resp_sito'), a), true, a);
  }
});

test('due ruoli: unione dei permessi', () => {
  const both = u('allievo', 'resp_ga');
  assert.equal(can(both, 'ga.enroll'), true);
  assert.equal(can(both, 'ga.approve'), true);
  assert.equal(can(both, 'admin.users'), false);
});

test('nessun utente o nessun ruolo: negato', () => {
  assert.equal(can(undefined, 'ga.view'), false);
  assert.equal(can(u(), 'ga.view'), false);
});

test('requireCan: redirect, 403 HTML, 403 JSON, ok', async () => {
  const app = express();
  app.use((req, _res, next) => {
    const r = req.header('x-roles');
    if (r !== undefined) req.user = { id: 1, roles: r ? (r.split(',') as RoleCode[]) : [] };
    next();
  });
  app.get('/x', requireCan('ga.approve'), (_req, res) => res.send('ok'));
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  try {
    const url = `http://localhost:${(server.address() as { port: number }).port}/x`;
    const anon = await fetch(url, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/login');
    const html = await fetch(url, { headers: { 'x-roles': 'allievo', accept: 'text/html' } });
    assert.equal(html.status, 403);
    assert.match(await html.text(), /Non autorizzato/);
    const json = await fetch(url, { headers: { 'x-roles': 'allievo', accept: 'application/json' } });
    assert.equal(json.status, 403);
    assert.deepEqual(await json.json(), { error: 'Non autorizzato' });
    const ok = await fetch(url, { headers: { 'x-roles': 'resp_ga' } });
    assert.equal(ok.status, 200);
  } finally {
    server.close();
  }
});

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
let sessionId: number;
let userId: number;

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  const year = (await pool.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const day = (await pool.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [year])).rows[0].id;
  const block = (await pool.query(`SELECT id FROM time_blocks WHERE kind = 'blocco' ORDER BY position LIMIT 1`)).rows[0].id;
  userId = (await pool.query(`INSERT INTO users (login_id, first_name, last_name) VALUES ('s@x.ch','S','S') RETURNING id`)).rows[0].id;
  const act = (await pool.query(
    `INSERT INTO activities (school_year_id, title, organizer_id, status, max_participants) VALUES ($1,'Live',$2,'approvata',3) RETURNING id`, [year, userId])).rows[0].id;
  sessionId = (await pool.query(`INSERT INTO activity_sessions (activity_id, ga_day_id, start_block_id) VALUES ($1,$2,$3) RETURNING id`, [act, day, block])).rows[0].id;
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 1, roles: ['allievo'] } as never;
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

// Apre uno stream SSE e restituisce i messaggi ricevuti finché non si chiama close().
async function openStream() {
  const ctl = new AbortController();
  const res = await fetch(`${base}/attivita/eventi`, { signal: ctl.signal });
  assert.ok(res.headers.get("content-type")!.startsWith("text/event-stream"));
  const messages: Record<string, { n: number; max: number }>[] = [];
  const reader = res.body!.getReader();
  (async () => {
    let buf = '';
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const m = buf.slice(0, i).match(/^data: (.*)$/m);
          buf = buf.slice(i + 2);
          if (m) messages.push(JSON.parse(m[1]));
        }
      }
    } catch {
      // chiuso
    }
  })();
  return { messages, close: () => ctl.abort() };
}

const waitFor = async (cond: () => boolean) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > 2000) assert.fail('nessun aggiornamento entro 2 secondi');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('due client: l\'iscrizione si vede nell\'altro entro 2 secondi, anche dopo la riconnessione', async () => {
  const a = await openStream();
  const b = await openStream();
  await waitFor(() => a.messages.length > 0 && b.messages.length > 0);
  assert.equal(b.messages.at(-1)![sessionId].n, 0);
  await pool.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1, $2)', [userId, sessionId]);
  await waitFor(() => b.messages.at(-1)![sessionId].n === 1);
  assert.equal(a.messages.at(-1)![sessionId].max, 3);
  a.close();
  b.close();
  // riconnessione: il nuovo client riceve subito lo stato aggiornato
  const c = await openStream();
  await waitFor(() => c.messages.length > 0);
  assert.equal(c.messages[0][sessionId].n, 1);
  await pool.query('DELETE FROM enrollments WHERE user_id = $1', [userId]);
  await waitFor(() => c.messages.at(-1)![sessionId].n === 0);
  c.close();
});

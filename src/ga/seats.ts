import type { Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { seatsSnapshot } from './activities';

// Hub SSE: un solo client Postgres in LISTEN 'ga_seats' finché c'è almeno un browser collegato.
// A ogni notifica manda a tutti lo stato completo dei posti (ponytail: poche centinaia di sessioni, nessun diff).
export function createSeatsHub(pool: Pool) {
  const clients = new Set<Response>();
  let listener: Promise<PoolClient> | null = null;

  async function broadcast() {
    if (!clients.size) return;
    const data = `data: ${JSON.stringify(await seatsSnapshot(pool))}\n\n`;
    for (const c of clients) c.write(data);
  }

  async function start() {
    const client = await pool.connect();
    client.on('notification', () => broadcast().catch(() => {}));
    client.on('error', () => {});
    await client.query('LISTEN ga_seats');
    return client;
  }

  async function stop() {
    const l = listener;
    listener = null;
    if (l) (await l).release(true); // true = chiude la connessione (niente LISTEN residuo nel pool)
  }

  return async function subscribe(res: Response) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    clients.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => {
      clearInterval(beat);
      clients.delete(res);
      if (!clients.size) stop().catch(() => {});
    });
    listener ??= start();
    await listener;
    res.write(`data: ${JSON.stringify(await seatsSnapshot(pool))}\n\n`);
  };
}

import type { Response } from 'express';
import { Pool, PoolClient } from 'pg';

// Hub SSE dei tornei: un solo client Postgres in LISTEN 'tornei_live' finché c'è almeno un browser collegato.
// La notifica porta l'id del torneo; ai browser di quel torneo si manda solo "aggiorna" (la pagina si ricarica da sola il pezzo #live).
// ponytail: nessun diff, poche centinaia di pagine aperte al massimo.
export function createLiveHub(pool: Pool) {
  const clients = new Map<Response, number>();
  let listener: Promise<PoolClient> | null = null;
  const pending = new Map<number, NodeJS.Timeout>();

  function notify(tid: number) {
    if (pending.has(tid)) return; // notifiche vicine = un solo invio ogni 300 ms
    pending.set(
      tid,
      setTimeout(() => {
        pending.delete(tid);
        for (const [c, id] of clients) if (id === tid) c.write('data: update\n\n');
      }, 300),
    );
  }

  function listen(): Promise<PoolClient> {
    const p = start();
    p.catch(() => {
      if (listener === p) listener = null;
    });
    return p;
  }

  async function start() {
    const client = await pool.connect();
    client.on('notification', (msg) => notify(Number(msg.payload)));
    client.on('error', () => {
      client.release(true);
      listener = null;
      if (clients.size) {
        setTimeout(() => {
          if (clients.size && !listener) listener = listen();
          for (const id of new Set(clients.values())) notify(id);
        }, 1000);
      }
    });
    try {
      await client.query('LISTEN tornei_live');
    } catch (e) {
      client.release(true);
      throw e;
    }
    return client;
  }

  async function stop() {
    const l = listener;
    listener = null;
    if (l) (await l).release(true);
  }

  return async function subscribe(res: Response, tid: number) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    clients.set(res, tid);
    const beat = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => {
      clearInterval(beat);
      clients.delete(res);
      if (!clients.size) stop().catch(() => {});
    });
    listener ??= listen();
    await listener;
    res.write('data: update\n\n');
  };
}

// Script delle pagine: a ogni "update" scarica di nuovo la pagina e sostituisce il contenuto di #live.
export const liveScript = (tid: number) => `<script>
(function(){
  var busy=false;
  function refresh(){
    if(busy) return; busy=true;
    fetch(location.href,{credentials:'same-origin'}).then(function(r){return r.text();}).then(function(h){
      var d=new DOMParser().parseFromString(h,'text/html').getElementById('live');
      var c=document.getElementById('live'); if(d&&c) c.innerHTML=d.innerHTML;
    }).catch(function(){}).then(function(){busy=false;});
  }
  var first=true;
  new EventSource('/tornei/${tid}/eventi').onmessage=function(){ if(first){first=false;return;} refresh(); };
})();
</script>`;

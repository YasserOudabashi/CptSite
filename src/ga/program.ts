import { Pool } from 'pg';
import { esc } from '../ui/layout';
import { listBlocks, listGaDays } from '../admin/settings';
import { blockLabel } from './proposals';

type Slot = { title: string; room: string | null; organizer: string; assigned: boolean };

// Programma dell'utente nell'anno corrente: un riquadro per giorno e blocco.
export async function programPage(pool: Pool, userId: number): Promise<string> {
  const [blocks, days, { rows }] = await Promise.all([
    listBlocks(pool),
    listGaDays(pool),
    pool.query(
      `SELECT eb.ga_day_id AS day, eb.block_id AS block, a.title, r.name AS room, u.first_name || ' ' || u.last_name AS organizer, e.assigned
       FROM enrollment_blocks eb JOIN enrollments e ON e.id = eb.enrollment_id
       JOIN activities a ON a.id = e.activity_id JOIN users u ON u.id = a.organizer_id LEFT JOIN rooms r ON r.id = a.room_id
       WHERE eb.user_id = $1 AND e.school_year_id = (SELECT id FROM school_years WHERE is_current)`,
      [userId],
    ),
  ]);
  const slots = new Map<string, Slot>(rows.map((r) => [`${r.day}:${r.block}`, r]));
  const shown = days.length ? days : [{ id: 0, day: null }];
  const tile = (dayId: number, b: (typeof blocks)[number]) => {
    const s = slots.get(`${dayId}:${b.id}`);
    const box = 'border:1px solid #8886;border-radius:.5rem;padding:.5rem 1rem;margin:.5rem 0';
    return s
      ? `<section style="${box}"><h3 style="margin:.25rem 0">${esc(blockLabel(b))}</h3><p style="margin:.25rem 0"><strong>${esc(s.title)}</strong>${
          s.assigned ? ' <em>(assegnata a caso)</em>' : ''
        }<br><small>Aula: ${s.room ? esc(s.room) : 'da definire'} · Organizzatore: ${esc(s.organizer)}</small></p></section>`
      : `<section style="${box};border-width:2px;border-color:#c60"><h3 style="margin:.25rem 0">${esc(blockLabel(b))}</h3><p style="margin:.25rem 0"><a href="/attivita?block=${b.id}">Scegli un'attività</a></p></section>`;
  };
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Il mio programma</title></head><body>
<h1>Il mio programma</h1>
${shown
    .map(
      (d) => `<h2>${d.day ? d.day.split('-').reverse().join('.') : 'Giorno da definire'}</h2>
${blocks.filter((b) => b.kind === 'blocco').map((b) => tile(d.id, b)).join('')}`,
    )
    .join('')}
</body></html>`;
}

import { Pool } from 'pg';
import { TimeBlock, listBlocks, listGaDays } from '../admin/settings';
import { getCurrentSchoolYear } from '../users/roles';

export const blockLabel = (b: TimeBlock) => `${b.name} · ${b.start.replace(/^0/, '')}–${b.end.replace(/^0/, '')}`;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Blocchi occupati da `count` blocchi consecutivi a partire da `startId`; null se non esistono
// o se tra due blocchi c'è più di una pausa breve (30 min): il pranzo e la fine della giornata non si attraversano.
export function blockSpan(blocks: TimeBlock[], startId: number, count: number): TimeBlock[] | null {
  const list = blocks.filter((b) => b.kind === 'blocco');
  const i = list.findIndex((b) => b.id === startId);
  const span = i < 0 ? [] : list.slice(i, i + count);
  if (span.length !== count) return null;
  for (let k = 1; k < span.length; k++) if (toMin(span[k].start) - toMin(span[k - 1].end) > 30) return null;
  return span;
}

export type ProposalInput = {
  title: string;
  description: string;
  phone: string;
  roomId: number | null;
  gaDayId: number | null;
  firstBlock: number;
  secondBlock: number;
  durationBlocks: number;
  repeat: boolean;
  materials: string;
  min: number;
  max: number;
};

// Legge i campi del modulo (stringhe) in un ProposalInput.
export function parseProposal(b: Record<string, unknown>): ProposalInput {
  const s = (k: string) => String(b[k] ?? '').trim();
  return {
    title: s('title'),
    description: s('description'),
    phone: s('phone'),
    roomId: Number(s('room')) || null,
    gaDayId: Number(s('day')) || null,
    firstBlock: Number(s('first')),
    secondBlock: Number(s('second')),
    durationBlocks: Number(s('duration') || 1),
    repeat: s('repeat') === '1',
    materials: s('materials'),
    min: Number(s('min') || 0),
    max: Number(s('max')),
  };
}

export async function createProposal(pool: Pool, userId: number, i: ProposalInput): Promise<number> {
  if (!i.title || !i.description || !i.phone) throw new Error('Nome, spiegazione e telefono sono obbligatori.');
  if (!Number.isInteger(i.max) || i.max < 1) throw new Error('Il massimo di allievi deve essere almeno 1.');
  if (!Number.isInteger(i.min) || i.min < 0 || i.min > i.max) throw new Error('Il minimo non può superare il massimo.');
  if (!Number.isInteger(i.durationBlocks) || i.durationBlocks < 1) throw new Error('La durata deve essere di almeno un blocco.');
  if (!i.firstBlock || !i.secondBlock) throw new Error('Scegli il blocco di prima e di seconda scelta.');
  if (i.firstBlock === i.secondBlock) throw new Error('La prima e la seconda scelta devono essere diverse.');
  const blocks = await listBlocks(pool);
  for (const id of [i.firstBlock, i.secondBlock]) {
    if (!blockSpan(blocks, id, i.durationBlocks)) {
      throw new Error('La durata scelta non entra nel blocco: non può attraversare il pranzo né superare la fine della giornata.');
    }
  }
  const year = await getCurrentSchoolYear(pool);
  if (i.gaDayId && !(await listGaDays(pool)).some((d) => d.id === i.gaDayId)) throw new Error('Giorno non valido.');
  if (i.roomId && !(await pool.query('SELECT 1 FROM rooms WHERE id = $1', [i.roomId])).rowCount) throw new Error('Aula non valida.');
  const { rows } = await pool.query(
    `INSERT INTO activities (school_year_id, title, description, organizer_id, contact, room_id, ga_day_id, duration_blocks,
       repetitions, first_block_id, second_block_id, materials, min_participants, max_participants)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [year.id, i.title, i.description, userId, i.phone, i.roomId, i.gaDayId, i.durationBlocks, i.repeat ? 2 : 1,
      i.firstBlock, i.secondBlock, i.materials, i.min, i.max],
  );
  return rows[0].id;
}

// Aule con i blocchi in cui sono già occupate da attività approvate dell'anno corrente (tutto lo span di ogni sessione, giorno compreso).
export async function roomsWithUsage(pool: Pool): Promise<{ id: number; name: string; busy: string[] }[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.name,
            COALESCE(array_agg(DISTINCT b.name || COALESCE(' ' || to_char(d.day, 'DD.MM'), '')) FILTER (WHERE b.id IS NOT NULL), '{}') AS busy
     FROM rooms r
     LEFT JOIN activities a ON a.room_id = r.id AND a.status = 'approvata'
       AND a.school_year_id = (SELECT id FROM school_years WHERE is_current)
     LEFT JOIN activity_sessions s ON s.activity_id = a.id
     LEFT JOIN session_blocks sb ON sb.session_id = s.id
     LEFT JOIN time_blocks b ON b.id = sb.block_id
     LEFT JOIN ga_days d ON d.id = sb.ga_day_id
     GROUP BY r.id ORDER BY lower(r.name)`,
  );
  return rows;
}

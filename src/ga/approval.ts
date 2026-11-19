import { Pool } from 'pg';
import { listBlocks } from '../admin/settings';
import { blockSpan } from './proposals';

export type Pending = {
  id: number;
  title: string;
  description: string;
  organizer: string;
  email: string;
  contact: string;
  room_id: number | null;
  duration_blocks: number;
  repetitions: number;
  ga_day_id: number | null;
  first_block_id: number;
  second_block_id: number;
  materials: string;
  min_participants: number;
  max_participants: number;
};

export async function listPending(pool: Pool): Promise<Pending[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, u.first_name || ' ' || u.last_name AS organizer, u.login_id AS email, a.contact,
            a.room_id, a.duration_blocks, a.repetitions, a.ga_day_id, a.first_block_id, a.second_block_id, a.materials,
            a.min_participants, a.max_participants
     FROM activities a JOIN users u ON u.id = a.organizer_id
     WHERE a.status = 'proposta' AND a.school_year_id = (SELECT id FROM school_years WHERE is_current)
     ORDER BY a.created_at, a.id`,
  );
  return rows;
}

// Per ogni blocco e giorno (chiave "giorno:blocco"): attività (sessioni) e posti già approvati nell'anno corrente, su tutto lo span.
export async function blockLoad(pool: Pool): Promise<Map<string, { activities: number; seats: number }>> {
  const { rows } = await pool.query(
    `SELECT sb.ga_day_id AS day, sb.block_id AS id, count(*)::int AS activities, sum(a.max_participants)::int AS seats
     FROM session_blocks sb JOIN activity_sessions s ON s.id = sb.session_id JOIN activities a ON a.id = s.activity_id
     WHERE a.status = 'approvata' AND a.school_year_id = (SELECT id FROM school_years WHERE is_current)
     GROUP BY sb.ga_day_id, sb.block_id`,
  );
  return new Map(rows.map((r) => [`${r.day}:${r.id}`, { activities: r.activities, seats: r.seats }]));
}

export type Edit = {
  title: string;
  description: string;
  contact: string;
  roomId: number | null;
  materials: string;
  min: number;
  max: number;
};

function checkEdit(e: Edit): void {
  if (!e.title || !e.description) throw new Error('Titolo e descrizione sono obbligatori.');
  if (!Number.isInteger(e.max) || e.max < 1) throw new Error('Il massimo deve essere almeno 1.');
  if (!Number.isInteger(e.min) || e.min < 0 || e.min > e.max) throw new Error('Il minimo non può superare il massimo.');
}

const SAVE = `UPDATE activities SET title=$2, description=$3, contact=$4, room_id=$5, materials=$6, min_participants=$7, max_participants=$8
              WHERE id = $1 AND status = 'proposta'`;
const saveArgs = (id: number, e: Edit) => [id, e.title, e.description, e.contact, e.roomId, e.materials, e.min, e.max];

export async function saveProposal(pool: Pool, id: number, e: Edit): Promise<void> {
  checkEdit(e);
  if (!(await pool.query(SAVE, saveArgs(id, e))).rowCount) throw new Error('Proposta non trovata o già decisa.');
}

// Approva (con eventuali modifiche) e crea le sessioni: `blockIds[i]` = blocco di partenza della ripetizione i+1.
export async function approveProposal(pool: Pool, id: number, e: Edit, blockIds: number[]): Promise<void> {
  checkEdit(e);
  const blocks = await listBlocks(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT school_year_id, ga_day_id, duration_blocks, repetitions FROM activities WHERE id = $1 AND status = 'proposta' FOR UPDATE`,
      [id],
    );
    const a = rows[0];
    if (!a) throw new Error('Proposta non trovata o già decisa.');
    if (blockIds.length !== a.repetitions || blockIds.some((b) => !Number.isInteger(b) || b <= 0)) throw new Error('Scegli il blocco di ogni sessione.');
    if (new Set(blockIds).size !== blockIds.length) throw new Error('Le due ripetizioni devono stare in blocchi diversi.');
    const used = new Set<number>();
    for (const b of blockIds) {
      const span = blockSpan(blocks, b, a.duration_blocks);
      if (!span) throw new Error('Il blocco scelto non basta per la durata (pranzo o fine giornata in mezzo).');
      // le due ripetizioni non possono occupare lo stesso blocco (es. durata 2 su B1 e B2)
      for (const x of span) {
        if (used.has(x.id)) throw new Error('Le due ripetizioni si sovrappongono: scegli blocchi che non si toccano.');
        used.add(x.id);
      }
    }
    // Giorno: quello scelto dal proponente, altrimenti il primo dell'anno (se non c'è nessun giorno se ne crea uno "da definire").
    let day = a.ga_day_id as number | null;
    if (!day) {
      const d = await client.query('SELECT id FROM ga_days WHERE school_year_id = $1 ORDER BY day NULLS LAST, id LIMIT 1', [a.school_year_id]);
      day = d.rows[0]?.id ?? (await client.query('INSERT INTO ga_days (school_year_id) VALUES ($1) RETURNING id', [a.school_year_id])).rows[0].id;
    }
    await client.query(SAVE, saveArgs(id, e));
    await client.query(`UPDATE activities SET status = 'approvata', ga_day_id = $2, reject_reason = NULL WHERE id = $1`, [id, day]);
    for (const [i, b] of blockIds.entries()) {
      await client.query(
        'INSERT INTO activity_sessions (activity_id, repeat_no, ga_day_id, start_block_id, block_count) VALUES ($1,$2,$3,$4,$5)',
        [id, i + 1, day, b, a.duration_blocks],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectProposal(pool: Pool, id: number, reason: string): Promise<void> {
  const r = await pool.query(`UPDATE activities SET status = 'rifiutata', reject_reason = $2 WHERE id = $1 AND status = 'proposta'`, [id, reason.trim() || null]);
  if (!r.rowCount) throw new Error('Proposta non trovata o già decisa.');
}

export async function materialsList(pool: Pool): Promise<{ title: string; organizer: string; materials: string }[]> {
  const { rows } = await pool.query(
    `SELECT a.title, u.first_name || ' ' || u.last_name AS organizer, a.materials
     FROM activities a JOIN users u ON u.id = a.organizer_id
     WHERE a.status = 'approvata' AND btrim(a.materials) <> '' AND a.school_year_id = (SELECT id FROM school_years WHERE is_current)
     ORDER BY a.title`,
  );
  return rows;
}

export function materialsCsv(rows: { title: string; organizer: string; materials: string }[]): string {
  // un valore che inizia con = + - @ verrebbe eseguito come formula da Excel: si neutralizza con un apice
  const q = (s: string) => `"${s.replace(/^(\s*[=+\-@]|[\t\r])/, "'$1").replace(/"/g, '""')}"`;
  // BOM per Excel; ';' come separatore (Excel italiano)
  return '﻿' + [['Attività', 'Organizzatore', 'Materiali'], ...rows.map((r) => [r.title, r.organizer, r.materials])].map((l) => l.map(q).join(';')).join('\r\n') + '\r\n';
}

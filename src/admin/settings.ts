import { Pool } from 'pg';
import QRCode from 'qrcode';

export type TimeBlock = { id: number; position: number; name: string; kind: 'blocco' | 'pausa'; start: string; end: string };
export type GaDay = { id: number; day: string | null };
export type SchoolYear = { id: number; name: string; is_current: boolean };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function listBlocks(pool: Pool): Promise<TimeBlock[]> {
  const { rows } = await pool.query(
    `SELECT id, position, name, kind, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
     FROM time_blocks ORDER BY position`,
  );
  return rows;
}

export async function updateBlock(pool: Pool, id: number, name: string, start: string, end: string): Promise<void> {
  name = name.trim();
  if (!name) throw new Error('Il nome del blocco è obbligatorio.');
  if (!TIME.test(start) || !TIME.test(end)) throw new Error('Orario non valido (usa il formato 08:30).');
  if (end <= start) throw new Error("La fine deve essere dopo l'inizio.");
  const { rowCount } = await pool.query('UPDATE time_blocks SET name = $2, start_time = $3, end_time = $4 WHERE id = $1', [
    id,
    name,
    start,
    end,
  ]);
  if (!rowCount) throw new Error('Blocco inesistente.');
}

export async function listSchoolYears(pool: Pool): Promise<SchoolYear[]> {
  const { rows } = await pool.query('SELECT id, name, is_current FROM school_years ORDER BY name DESC');
  return rows;
}

export async function createSchoolYear(pool: Pool, name: string): Promise<void> {
  name = name.trim();
  if (!/^\d{4}-\d{4}$/.test(name)) throw new Error('Nome anno non valido (es. 2027-2028).');
  const { rowCount } = await pool.query('INSERT INTO school_years (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
  if (!rowCount) throw new Error('Anno scolastico già esistente.');
}

export async function setCurrentSchoolYear(pool: Pool, id: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('SELECT 1 FROM school_years WHERE id = $1', [id]);
    if (!rowCount) throw new Error('Anno scolastico inesistente.');
    // Prima si toglie il corrente, poi si imposta il nuovo (indice unico parziale).
    await client.query('UPDATE school_years SET is_current = false WHERE is_current');
    await client.query('UPDATE school_years SET is_current = true WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Date GA dell'anno corrente. Nessuna riga = "da definire"; una riga con day NULL = giorno ancora senza data.
export async function listGaDays(pool: Pool): Promise<GaDay[]> {
  const { rows } = await pool.query(
    `SELECT d.id, to_char(d.day, 'YYYY-MM-DD') AS day
     FROM ga_days d JOIN school_years y ON y.id = d.school_year_id AND y.is_current
     ORDER BY d.day NULLS LAST, d.id`,
  );
  return rows;
}

export async function addGaDay(pool: Pool, day: string): Promise<void> {
  day = day.trim();
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))) throw new Error('Data non valida.');
  await pool.query(
    `INSERT INTO ga_days (school_year_id, day) SELECT id, $1::date FROM school_years WHERE is_current`,
    [day || null],
  );
}

export async function removeGaDay(pool: Pool, id: number): Promise<void> {
  await pool.query('DELETE FROM ga_days WHERE id = $1', [id]);
}

export function gaDatesLabel(days: GaDay[]): string {
  const dated = days.filter((d) => d.day).map((d) => d.day!.split('-').reverse().join('.'));
  return dated.length ? dated.join(', ') : 'da definire';
}

export function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: 'png', width: 600, margin: 2 });
}

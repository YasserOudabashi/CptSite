import { Pool } from 'pg';
import { hashSecret, verifySecret } from '../auth/password';
import { getCurrentSchoolYear } from '../users/roles';

export interface CsvResult {
  added: number;
  duplicates: number;
  errors: { line: number; value: string }[];
}

export function schoolDomain(): string {
  return (process.env.SCHOOL_DOMAIN ?? 'studenti.edu.ti.ch').toLowerCase();
}

export function isValidStudentId(id: string): boolean {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(id);
  return !!m && m[1].toLowerCase() === schoolDomain();
}

// Una riga per ID. Righe vuote saltate; riga non valida segnalata con il suo numero (da 1).
// Un'intestazione tipo "ID" in prima riga viene ignorata.
export async function importStudentIds(pool: Pool, csv: string): Promise<CsvResult> {
  const year = await getCurrentSchoolYear(pool);
  const result: CsvResult = { added: 0, duplicates: 0, errors: [] };
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const value = lines[i].trim().replace(/^"|"$/g, '').trim();
    if (!value) continue;
    if (i === 0 && !value.includes('@') && /^(id|login|e-?mail)$/i.test(value)) continue;
    if (!isValidStudentId(value)) {
      result.errors.push({ line: i + 1, value: lines[i].trim() });
      continue;
    }
    const { rowCount } = await pool.query(
      `INSERT INTO student_ids (school_year_id, login_id) VALUES ($1, $2)
       ON CONFLICT (school_year_id, lower(login_id)) DO NOTHING`,
      [year.id, value],
    );
    if (rowCount) result.added++;
    else result.duplicates++;
  }
  return result;
}

export async function countStudentIds(pool: Pool): Promise<number> {
  const year = await getCurrentSchoolYear(pool);
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM student_ids WHERE school_year_id = $1',
    [year.id],
  );
  return rows[0].n;
}

// Elenco vuoto = qualunque indirizzo del dominio scolastico; elenco caricato = solo gli ID presenti.
export async function isAllowedStudentId(pool: Pool, loginId: string): Promise<boolean> {
  if (!isValidStudentId(loginId)) return false;
  if ((await countStudentIds(pool)) === 0) return true;
  const year = await getCurrentSchoolYear(pool);
  const { rowCount } = await pool.query(
    'SELECT 1 FROM student_ids WHERE school_year_id = $1 AND lower(login_id) = lower($2)',
    [year.id, loginId],
  );
  return !!rowCount;
}

export async function setGeneralCode(pool: Pool, code: string): Promise<void> {
  if (code.trim().length < 4) throw new Error('Il codice generale deve avere almeno 4 caratteri');
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('general_code_hash', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [await hashSecret(code)],
  );
}

export async function hasGeneralCode(pool: Pool): Promise<boolean> {
  const { rowCount } = await pool.query(`SELECT 1 FROM app_settings WHERE key = 'general_code_hash'`);
  return !!rowCount;
}

export async function checkGeneralCode(pool: Pool, code: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'general_code_hash'`);
  return rows.length === 1 && verifySecret(code, rows[0].value);
}

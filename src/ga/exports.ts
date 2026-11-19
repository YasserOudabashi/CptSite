import { Pool } from 'pg';
import { crc32 } from 'node:zlib';
import { KIND } from './activities';
import { listPeople } from './manage';

export const WHAT = ['attivita', 'allievi', 'relatori', 'docenti', 'presenze'] as const;
export type What = (typeof WHAT)[number];
export type ExportFilters = { kind?: string; ids?: number[]; classe?: string };

// CSV per Excel: BOM UTF-8, ';' come separatore, valori che iniziano con = + - @ neutralizzati con un apice (niente formule).
export function toCsv(rows: string[][]): string {
  const q = (s: string) => `"${s.replace(/^(\s*[=+\-@]|[\t\r])/, "'$1").replace(/"/g, '""')}"`;
  return '﻿' + rows.map((l) => l.map(q).join(';')).join('\r\n') + '\r\n';
}

const xml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// A..Z, AA..AZ, ...
const col = (i: number): string => (i < 26 ? '' : col(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));

// XLSX minimo (un foglio, testo in celle inlineStr, zip senza compressione): nessuna dipendenza.
// ponytail: solo testo; i numeri restano stringhe. Se servono formati, passare a una libreria.
export function toXlsx(rows: string[][], sheet = 'Foglio1'): Buffer {
  const cells = rows
    .map((r, y) => `<row r="${y + 1}">${r.map((v, x) => `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`)
    .join('');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: [string, string][] = [
    ['[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets><sheet name="${xml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`],
  ];
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = Buffer.from(name);
    const d = Buffer.from(text);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // nomi UTF-8
    h.writeUInt16LE(0x21, 12); // data 1980-01-01
    h.writeUInt32LE(crc32(d), 14);
    h.writeUInt32LE(d.length, 18);
    h.writeUInt32LE(d.length, 22);
    h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    h.copy(c, 8, 6, 30); // flags, metodo, ora, data, crc, dimensioni, lunghezza nome
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    parts.push(h, n, d);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// Righe (intestazione compresa) dell'export richiesto, solo per l'anno scelto.
export async function exportRows(pool: Pool, what: What, yearId: number, f: ExportFilters = {}): Promise<string[][]> {
  const args: unknown[] = [yearId];
  const p = (v: unknown) => `$${args.push(v)}`;
  const act: string[] = [];
  if (f.kind) act.push(`${KIND} = ${p(f.kind)}`);
  if (f.ids?.length) act.push(`a.id = ANY(${p(f.ids)}::int[])`);
  const w = act.map((x) => ' AND ' + x).join('');
  const days = `COALESCE(to_char(d.day, 'DD.MM.YYYY'), 'da definire')`;
  const blocks = `(SELECT string_agg(b.name, ' + ' ORDER BY b.position) FROM session_blocks sb JOIN time_blocks b ON b.id = sb.block_id WHERE sb.session_id = s.id)`;
  const q = async (sql: string) => (await pool.query({ text: sql, values: args, rowMode: 'array' })).rows.map((r: unknown[]) => r.map((v) => String(v ?? '')));

  if (what === 'attivita') {
    return [['Attività', 'Stato', 'Organizzatore', 'Tipo', 'E-mail', 'Telefono', 'Aula', 'Giorno', 'Blocchi', 'Iscritti', 'Massimo', 'Minimo'],
      ...(await q(`SELECT a.title, a.status, u.first_name || ' ' || u.last_name, ${KIND}, u.login_id, a.contact, r.name, ${days}, ${blocks},
                          (SELECT count(*) FROM enrollments e WHERE e.session_id = s.id), a.max_participants, a.min_participants
                   FROM activities a JOIN users u ON u.id = a.organizer_id LEFT JOIN rooms r ON r.id = a.room_id
                   LEFT JOIN activity_sessions s ON s.activity_id = a.id LEFT JOIN ga_days d ON d.id = s.ga_day_id
                   WHERE a.school_year_id = $1${w} ORDER BY a.title, s.repeat_no`))];
  }
  if (what === 'presenze') {
    return [['Attività', 'Giorno', 'Blocchi', 'Cognome', 'Nome', 'Classe', 'Presenza'],
      ...(await q(`SELECT a.title, ${days}, ${blocks}, st.last_name, st.first_name, st.class_name,
                          CASE e.present WHEN true THEN 'presente' WHEN false THEN 'assente' ELSE 'non segnata' END
                   FROM enrollments e JOIN activity_sessions s ON s.id = e.session_id JOIN activities a ON a.id = s.activity_id
                   JOIN users u ON u.id = a.organizer_id JOIN users st ON st.id = e.user_id JOIN ga_days d ON d.id = s.ga_day_id
                   WHERE a.school_year_id = $1${w} ORDER BY a.title, d.day, s.repeat_no, st.last_name, st.first_name`))];
  }
  if (what === 'allievi') {
    const cls = f.classe?.trim() ? ` AND u.class_name = ${p(f.classe.trim())}` : '';
    return [['Cognome', 'Nome', 'ID', 'Classe', 'Programma'],
      ...(await q(`SELECT u.last_name, u.first_name, u.login_id, u.class_name,
                          COALESCE((SELECT string_agg(COALESCE(to_char(d.day, 'DD.MM'), 'giorno da definire') || ' ' || ${blocks} || ': ' || a.title, '; ' ORDER BY d.day, s.start_block_id)
                                    FROM enrollments e JOIN activity_sessions s ON s.id = e.session_id JOIN activities a ON a.id = s.activity_id JOIN ga_days d ON d.id = s.ga_day_id
                                    WHERE e.user_id = u.id AND e.school_year_id = $1), '')
                   FROM users u
                   WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role_code = 'allievo')
                     AND (EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.school_year_id = $1)
                          OR (u.password_hash IS NOT NULL AND (SELECT is_current FROM school_years WHERE id = $1)))${cls}
                   ORDER BY u.last_name, u.first_name`))];
  }
  const people = await listPeople(pool, yearId, what === 'relatori' ? 'relatore' : 'docente');
  return [['Nome', 'E-mail', 'Telefono', 'Attività'], ...people.map((x) => [x.name, x.email, x.phone, x.titles.join('; ')])];
}

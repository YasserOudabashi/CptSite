import { Pool } from 'pg';
import { can } from '../auth/permissions';
import type { RoleCode } from '../users/roles';
import { getCurrentSchoolYear } from '../users/roles';

export type User = { id: number; roles: readonly RoleCode[] };

export interface Tournament {
  id: number;
  school_year_id: number;
  year_name: string;
  is_current: boolean;
  activity_id: number | null;
  created_by: number;
  name: string;
  sport: string;
  description: string;
  rules: string;
  mode: 'squadre' | 'singoli';
  team_min: number;
  team_max: number;
  format: 'girone' | 'eliminazione' | 'gironi_eliminazione';
  double_round: boolean;
  groups_count: number;
  qualifiers: number;
  score_type: 'punti' | 'set';
  best_of: number;
  pts_win: number;
  pts_draw: number;
  pts_loss: number;
  forfeit_score: number;
  tiebreaks: string;
  match_minutes: number;
  max_teams: number;
  status: 'bozza' | 'iscrizioni' | 'in corso' | 'concluso';
}

export const FORMATS: Record<string, string> = {
  girone: "Girone all'italiana",
  eliminazione: 'Eliminazione diretta',
  gironi_eliminazione: 'Gironi + eliminazione',
};
export const CRITERIA: Record<string, string> = {
  punti: 'punti',
  scontro_diretto: 'scontro diretto',
  differenza: 'differenza reti/set',
  fatti: 'gol/punti fatti',
  sorteggio: 'sorteggio',
};

export async function getTournament(pool: Pool, id: number): Promise<Tournament | undefined> {
  return (
    await pool.query<Tournament>(
      `SELECT t.*, y.name AS year_name, y.is_current FROM tournaments t JOIN school_years y ON y.id = t.school_year_id WHERE t.id = $1`,
      [id],
    )
  ).rows[0];
}

export async function isOrganizer(pool: Pool, tid: number, userId: number): Promise<boolean> {
  return (await pool.query('SELECT 1 FROM tournament_organizers WHERE tournament_id = $1 AND user_id = $2', [tid, userId])).rowCount === 1;
}
export async function isReferee(pool: Pool, tid: number, userId: number): Promise<boolean> {
  return (await pool.query('SELECT 1 FROM tournament_referees WHERE tournament_id = $1 AND user_id = $2', [tid, userId])).rowCount === 1;
}

// Il Responsabile tornei (e il Responsabile sito) gestisce tutto; l'Organizzatore torneo solo il suo.
export async function canManage(pool: Pool, user: User | undefined, tid: number): Promise<boolean> {
  if (!user) return false;
  return can(user, 'tornei.manage') || (await isOrganizer(pool, tid, user.id));
}

// Una bozza la vedono solo Responsabile tornei e organizzatori; gli altri tornei tutti gli utenti loggati.
export async function canSee(pool: Pool, user: User | undefined, t: Tournament): Promise<boolean> {
  return !!user && (t.status !== 'bozza' || (await canManage(pool, user, t.id)));
}

export async function approvedActivities(pool: Pool, userId?: number): Promise<{ id: number; title: string }[]> {
  const y = await getCurrentSchoolYear(pool);
  return (
    await pool.query(
      `SELECT id, title FROM activities WHERE school_year_id = $1 AND status = 'approvata' AND ($2::int IS NULL OR organizer_id = $2) ORDER BY title`,
      [y.id, userId ?? null],
    )
  ).rows;
}

export async function canCreate(pool: Pool, user: User): Promise<boolean> {
  return can(user, 'tornei.manage') || (await approvedActivities(pool, user.id)).length > 0;
}

const SETTINGS = ['mode', 'team_min', 'team_max', 'format', 'double_round', 'groups_count', 'qualifiers', 'score_type', 'best_of', 'pts_win', 'pts_draw', 'pts_loss', 'forfeit_score', 'tiebreaks', 'match_minutes', 'max_teams'] as const;

type Body = Record<string, unknown>;

function int(b: Body, k: string, label: string, min: number, max: number): number {
  const n = Number(String(b[k] ?? '').trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: serve un numero intero tra ${min} e ${max}.`);
  return n;
}

export function parseTournament(b: Body) {
  const name = String(b.name ?? '').trim();
  const sport = String(b.sport ?? '').trim();
  if (!name || !sport) throw new Error('Nome e sport sono obbligatori.');
  const mode = b.mode === 'singoli' ? 'singoli' : 'squadre';
  const format = String(b.format ?? 'girone');
  if (!(format in FORMATS)) throw new Error('Formato non valido.');
  const score_type = b.score_type === 'set' ? 'set' : 'punti';
  const team_min = mode === 'singoli' ? 1 : int(b, 'team_min', 'Giocatori minimi', 1, 50);
  const team_max = mode === 'singoli' ? 1 : int(b, 'team_max', 'Giocatori massimi', 1, 50);
  if (team_min > team_max) throw new Error('I giocatori minimi non possono superare i massimi.');
  const tiebreaks = String(b.tiebreaks ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (tiebreaks.some((c) => !(c in CRITERIA)) || new Set(tiebreaks).size !== tiebreaks.length) throw new Error('Criteri di spareggio non validi.');
  if (!tiebreaks.includes('sorteggio')) tiebreaks.push('sorteggio');
  return {
    name,
    sport,
    description: String(b.description ?? '').trim(),
    rules: String(b.rules ?? '').trim(),
    mode,
    team_min,
    team_max,
    format,
    double_round: b.double_round === 'on' || b.double_round === 'true',
    groups_count: int(b, 'groups_count', 'Gironi', 1, 16),
    qualifiers: int(b, 'qualifiers', 'Qualificate per girone', 1, 16),
    score_type,
    best_of: score_type === 'set' ? int(b, 'best_of', 'Set (al meglio di)', 1, 9) : 3,
    pts_win: int(b, 'pts_win', 'Punti per vittoria', 0, 20),
    pts_draw: int(b, 'pts_draw', 'Punti per pareggio', 0, 20),
    pts_loss: int(b, 'pts_loss', 'Punti per sconfitta', 0, 20),
    forfeit_score: int(b, 'forfeit_score', 'Punteggio del forfait', 0, 99),
    tiebreaks: tiebreaks.join(','),
    match_minutes: int(b, 'match_minutes', 'Durata partita', 1, 600),
    max_teams: int(b, 'max_teams', 'Massimo squadre', 2, 128),
  };
}

export async function createTournament(pool: Pool, user: User, b: Body): Promise<number> {
  if (!(await canCreate(pool, user))) throw new Error('Non puoi creare tornei.');
  const v = parseTournament(b);
  const activity = Number(b.activity_id) || null;
  const manager = can(user, 'tornei.manage');
  if (!activity && !manager) throw new Error('Scegli l\'attività GA a cui collegare il torneo.');
  if (activity && !(await approvedActivities(pool, manager ? undefined : user.id)).some((a) => a.id === activity)) {
    throw new Error('Attività non valida: serve un\'attività approvata di quest\'anno' + (manager ? '.' : ' di cui sei organizzatore.'));
  }
  const y = await getCurrentSchoolYear(pool);
  const keys = Object.keys(v) as (keyof typeof v)[];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO tournaments (school_year_id, activity_id, created_by, ${keys.join(',')})
       VALUES ($1,$2,$3,${keys.map((_, i) => `$${i + 4}`).join(',')}) RETURNING id`,
      [y.id, activity, user.id, ...keys.map((k) => v[k])],
    );
    await client.query('INSERT INTO tournament_organizers (tournament_id, user_id) VALUES ($1,$2)', [rows[0].id, user.id]);
    await client.query('COMMIT');
    return rows[0].id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function hasMatches(pool: Pool, tid: number): Promise<boolean> {
  return (await pool.query('SELECT 1 FROM tournament_matches WHERE tournament_id = $1 LIMIT 1', [tid])).rowCount === 1;
}

// Dopo la generazione del calendario si cambiano solo nome, descrizione e regolamento.
export async function updateTournament(pool: Pool, user: User, id: number, b: Body): Promise<void> {
  const t = await getTournament(pool, id);
  if (!t || !(await canManage(pool, user, id))) throw new Error('Non puoi modificare questo torneo.');
  if (t.status === 'concluso') throw new Error('Il torneo è concluso.');
  if (await hasMatches(pool, id)) {
    const name = String(b.name ?? '').trim();
    if (!name) throw new Error('Il nome è obbligatorio.');
    await pool.query('UPDATE tournaments SET name = $2, description = $3, rules = $4 WHERE id = $1', [id, name, String(b.description ?? '').trim(), String(b.rules ?? '').trim()]);
    return;
  }
  const v = parseTournament(b);
  const keys = ['name', 'description', 'rules', 'sport', ...SETTINGS] as const;
  await pool.query(`UPDATE tournaments SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(',')} WHERE id = $1`, [id, ...keys.map((k) => v[k])]);
}

// Stati a mano: bozza → iscrizioni (e ritorno, finché non ci sono squadre); in corso → concluso.
export async function setStatus(pool: Pool, user: User, id: number, to: string): Promise<void> {
  const t = await getTournament(pool, id);
  if (!t || !(await canManage(pool, user, id))) throw new Error('Non puoi modificare questo torneo.');
  const ok =
    (t.status === 'bozza' && to === 'iscrizioni') ||
    (t.status === 'iscrizioni' && to === 'bozza' && !(await pool.query('SELECT 1 FROM tournament_teams WHERE tournament_id = $1', [id])).rowCount) ||
    (t.status === 'in corso' && to === 'concluso');
  if (!ok) throw new Error(`Passaggio da "${t.status}" a "${to}" non consentito.`);
  await pool.query('UPDATE tournaments SET status = $2 WHERE id = $1', [id, to]);
}

// Cerca un utente per ID (e-mail) esatto o per nome: deve esserci un solo risultato.
export async function findUser(pool: Pool, q: string): Promise<{ id: number; name: string }> {
  q = q.trim();
  if (!q) throw new Error('Scrivi nome o ID.');
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await pool.query<{ id: number; name: string; login_id: string }>(
    `SELECT id, first_name || ' ' || last_name AS name, login_id FROM users
     WHERE lower(login_id) = lower($1) OR (first_name || ' ' || last_name) ILIKE $2 OR (last_name || ' ' || first_name) ILIKE $2 OR login_id ILIKE $2
     ORDER BY (lower(login_id) = lower($1)) DESC LIMIT 5`,
    [q, like],
  );
  if (!rows.length) throw new Error(`Nessun utente trovato per "${q}".`);
  if (rows.length > 1 && rows[0].login_id.toLowerCase() !== q.toLowerCase()) throw new Error(`Più utenti per "${q}": scrivi l'ID completo.`);
  return rows[0];
}

export async function addPerson(pool: Pool, user: User, tid: number, kind: 'organizers' | 'referees', q: string): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  const u = await findUser(pool, q);
  await pool.query(`INSERT INTO tournament_${kind} (tournament_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tid, u.id]);
}

// Il torneo deve conservare almeno un organizzatore.
export async function removePerson(pool: Pool, user: User, tid: number, kind: 'organizers' | 'referees', userId: number): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  if (kind === 'organizers' && (await pool.query('SELECT 1 FROM tournament_organizers WHERE tournament_id = $1 AND user_id <> $2', [tid, userId])).rowCount === 0) {
    throw new Error('Il torneo deve avere almeno un organizzatore.');
  }
  await pool.query(`DELETE FROM tournament_${kind} WHERE tournament_id = $1 AND user_id = $2`, [tid, userId]);
}

export async function people(pool: Pool, tid: number, kind: 'organizers' | 'referees') {
  return (
    await pool.query<{ id: number; name: string }>(
      `SELECT u.id, u.first_name || ' ' || u.last_name AS name FROM tournament_${kind} p JOIN users u ON u.id = p.user_id WHERE p.tournament_id = $1 ORDER BY u.last_name, u.first_name`,
      [tid],
    )
  ).rows;
}

export async function listFields(pool: Pool, tid: number) {
  return (await pool.query<{ id: number; name: string }>('SELECT id, name FROM tournament_fields WHERE tournament_id = $1 ORDER BY id', [tid])).rows;
}
export async function addField(pool: Pool, user: User, tid: number, name: string): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  if (!name.trim()) throw new Error('Scrivi il nome del campo.');
  await pool.query('INSERT INTO tournament_fields (tournament_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tid, name.trim()]);
}
export async function removeField(pool: Pool, user: User, tid: number, id: number): Promise<void> {
  if (!(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  await pool.query('DELETE FROM tournament_fields WHERE tournament_id = $1 AND id = $2', [tid, id]);
}

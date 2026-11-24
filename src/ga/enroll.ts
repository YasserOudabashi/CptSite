import { Pool } from 'pg';
import { can } from '../auth/permissions';
import { sendEnrollmentOpen } from '../mail';
import type { RoleCode } from '../users/roles';

type User = { id: number; roles: readonly RoleCode[] };
export const STATES = { solo_organizzatori: 'Solo organizzatori', aperte: 'Aperte a tutti', chiuse: 'Chiuse' } as const;
export type EnrollState = keyof typeof STATES;

export async function getEnrollState(pool: Pool): Promise<EnrollState> {
  return (await pool.query('SELECT enrollment_state FROM school_years WHERE is_current')).rows[0].enrollment_state;
}

// Il Responsabile GA ignora lo stato delle iscrizioni.
function checkState(state: EnrollState, user: User, isOrganizer: boolean): void {
  if (can(user, 'ga.manage')) return;
  if (state === 'chiuse') throw new Error('Le iscrizioni sono chiuse.');
  if (state === 'solo_organizzatori' && !isOrganizer) {
    throw new Error('Le iscrizioni sono aperte per ora solo a chi ha un\'attività approvata: aspetta l\'apertura a tutti.');
  }
}

const isOrganizerQ = `EXISTS (SELECT 1 FROM activities WHERE organizer_id = $1 AND school_year_id = y.id AND status = 'approvata')`;

export async function enroll(pool: Pool, user: User, sessionId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query('SELECT activity_id FROM activity_sessions WHERE id = $1', [sessionId]);
    if (!s.rowCount) throw new Error('Sessione non trovata.');
    // Il lock sull'attività serializza le iscrizioni: si conta e si inserisce senza che altri passino nel mezzo.
    const { rows } = await client.query(
      `SELECT a.max_participants AS max, a.status, y.is_current, y.enrollment_state AS state, ${isOrganizerQ} AS organizer
       FROM activities a JOIN school_years y ON y.id = a.school_year_id
       WHERE a.id = $2 FOR UPDATE OF a`,
      [user.id, s.rows[0].activity_id],
    );
    const a = rows[0];
    if (a.status !== 'approvata' || !a.is_current) throw new Error('Attività non disponibile.');
    checkState(a.state, user, a.organizer);
    if ((await client.query('SELECT 1 FROM enrollments WHERE user_id = $1 AND activity_id = $2', [user.id, s.rows[0].activity_id])).rowCount) {
      throw new Error('Sei già iscritto a questa attività.');
    }
    // Blocchi in cui l'utente organizza un'attività approvata contano come occupati (FR-10).
    if ((await client.query(
      `SELECT 1 FROM session_blocks t JOIN activity_sessions ts ON ts.id = t.session_id
       JOIN session_blocks o ON o.block_id = t.block_id AND o.ga_day_id = t.ga_day_id
       JOIN activity_sessions os ON os.id = o.session_id JOIN activities oa ON oa.id = os.activity_id
       WHERE t.session_id = $2 AND oa.organizer_id = $1 AND oa.status = 'approvata' AND oa.school_year_id = (SELECT id FROM school_years WHERE is_current) LIMIT 1`,
      [user.id, sessionId],
    )).rowCount) throw new Error('Sei già impegnato in quel blocco con la tua attività.');
    const n = (await client.query('SELECT count(*)::int AS n FROM enrollments WHERE session_id = $1', [sessionId])).rows[0].n;
    if (n >= a.max) throw new Error('Attività piena: non ci sono più posti.');
    try {
      await client.query('INSERT INTO enrollments (user_id, session_id) VALUES ($1, $2)', [user.id, sessionId]);
    } catch (e) {
      const c = (e as { constraint?: string }).constraint ?? '';
      if (c.startsWith('enrollment_blocks')) throw new Error('Sei già iscritto a un\'altra attività nello stesso blocco.');
      if (c.startsWith('enrollments_user_id_activity_id')) throw new Error('Sei già iscritto a questa attività.');
      throw e;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelEnrollment(pool: Pool, user: User, sessionId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT y.enrollment_state AS state, e.present, ${isOrganizerQ} AS organizer
     FROM enrollments e JOIN school_years y ON y.id = e.school_year_id AND y.is_current
     WHERE e.user_id = $1 AND e.session_id = $2`,
    [user.id, sessionId],
  );
  if (!rows[0]) throw new Error('Non sei iscritto a questa sessione.');
  if (rows[0].present !== null) throw new Error('La presenza è già stata segnata: l\'iscrizione non si annulla più.');
  checkState(rows[0].state, user, rows[0].organizer);
  await pool.query('DELETE FROM enrollments WHERE user_id = $1 AND session_id = $2 AND present IS NULL', [user.id, sessionId]);
}

// Sessioni a cui l'utente è iscritto nell'anno corrente.
export async function mySessionIds(pool: Pool, userId: number): Promise<Set<number>> {
  const { rows } = await pool.query(
    `SELECT e.session_id FROM enrollments e JOIN school_years y ON y.id = e.school_year_id AND y.is_current WHERE e.user_id = $1`,
    [userId],
  );
  return new Set(rows.map((r) => r.session_id));
}

export async function setEnrollState(pool: Pool, state: string): Promise<void> {
  if (!(state in STATES)) throw new Error('Stato non valido.');
  await pool.query('UPDATE school_years SET enrollment_state = $1 WHERE is_current', [state]);
}

// Porta le iscrizioni ad "Aperte a tutti" e avvia la mail di apertura (una sola volta per anno, salvo conferma esplicita).
export async function openEnrollment(pool: Pool, userId: number, resend: boolean): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT enrollment_mail_sent_at AS sent FROM school_years WHERE is_current FOR UPDATE');
    if (rows[0].sent && !resend) {
      throw new Error('La mail di apertura è già stata inviata quest\'anno: per reinviarla spunta la conferma.');
    }
    await client.query(`UPDATE school_years SET enrollment_state = 'aperte' WHERE is_current`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // Dopo il commit: sendEnrollmentOpen segna enrollment_mail_sent_at solo quando l'accodamento è riuscito; il worker riprova gli invii falliti.
  return (await sendEnrollmentOpen(pool, { createdBy: userId })).recipients;
}

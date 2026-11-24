import { Pool, PoolClient } from 'pg';

type Q = Pool | PoolClient;
export type Unassigned = { user: string; day: string; block: string };
export type Plan = {
  students: number; // allievi registrati con almeno un blocco libero
  slots: number; // coppie (allievo, blocco) da riempire
  freeSeats: number; // posti liberi in tutte le sessioni approvate
  rows: { userId: number; sessionId: number }[];
  unassignable: Unassigned[];
  notRegistered: string[]; // ID dell'elenco non ancora registrati (non assegnabili)
};

const shuffle = <T>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Calcola (senza scrivere) chi assegnare a cosa: per ogni allievo registrato e per ogni blocco senza iscrizione
// cerca una sessione con posti liberi i cui blocchi siano tutti liberi per lui (niente doppi impegni, mai la stessa attività due volte).
export async function buildPlan(q: Q): Promise<Plan> {
  const year = (await q.query('SELECT id FROM school_years WHERE is_current')).rows[0].id;
  const [students, sessions, taken, acts, positions, list, organizing] = await Promise.all([
    q.query(`SELECT u.id, u.last_name || ' ' || u.first_name AS name FROM users u
             WHERE u.password_hash IS NOT NULL AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role_code = 'allievo')
               AND (NOT EXISTS (SELECT 1 FROM student_ids si WHERE si.school_year_id = $1) OR EXISTS (SELECT 1 FROM student_ids si WHERE si.school_year_id = $1 AND lower(si.login_id) = lower(u.login_id)))
             ORDER BY u.id`, [year]),
    q.query(
      `SELECT s.id, s.activity_id AS act, s.ga_day_id AS day, a.max_participants - (SELECT count(*) FROM enrollments e WHERE e.session_id = s.id) AS free,
              (SELECT array_agg(sb.block_id) FROM session_blocks sb WHERE sb.session_id = s.id) AS blocks
       FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
       WHERE a.status = 'approvata' AND a.school_year_id = $1`,
      [year],
    ),
    q.query(`SELECT eb.user_id, eb.ga_day_id, eb.block_id FROM enrollment_blocks eb JOIN enrollments e ON e.id = eb.enrollment_id WHERE e.school_year_id = $1`, [year]),
    q.query('SELECT user_id, activity_id FROM enrollments WHERE school_year_id = $1', [year]),
    q.query(`SELECT b.id, b.position, b.name, to_char(d.day, 'DD.MM.YYYY') AS day, d.id AS day_id
             FROM time_blocks b CROSS JOIN ga_days d WHERE b.kind = 'blocco' AND d.school_year_id = $1 ORDER BY d.day NULLS LAST, d.id, b.position`, [year]),
    q.query(`SELECT s.login_id FROM student_ids s WHERE s.school_year_id = $1
             AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.login_id) = lower(s.login_id) AND u.password_hash IS NOT NULL) ORDER BY s.login_id`, [year]),
    // Blocchi in cui l'utente organizza un'attività approvata: sono occupati (FR-10).
    q.query(`SELECT a.organizer_id AS user_id, sb.ga_day_id, sb.block_id FROM session_blocks sb JOIN activity_sessions s ON s.id = sb.session_id
             JOIN activities a ON a.id = s.activity_id WHERE a.status = 'approvata' AND a.school_year_id = $1`, [year]),
  ]);
  const free = new Map<number, number>(sessions.rows.map((s) => [s.id, Number(s.free)]));
  // blocchi (giorno:blocco) coperti da almeno una sessione: solo questi si possono riempire
  const covered = new Set<string>(sessions.rows.flatMap((s) => (s.blocks as number[]).map((b) => `${s.day}:${b}`)));
  const slotInfo = positions.rows.filter((p) => covered.has(`${p.day_id}:${p.id}`));
  const busy = new Map<number, Set<string>>();
  for (const t of taken.rows) busy.set(t.user_id, (busy.get(t.user_id) ?? new Set()).add(`${t.ga_day_id}:${t.block_id}`));
  for (const t of organizing.rows) busy.set(t.user_id, (busy.get(t.user_id) ?? new Set()).add(`${t.ga_day_id}:${t.block_id}`));
  const done = new Map<number, Set<number>>();
  for (const e of acts.rows) done.set(e.user_id, (done.get(e.user_id) ?? new Set()).add(e.activity_id));

  const plan: Plan = {
    students: 0,
    slots: 0,
    freeSeats: [...free.values()].reduce((a, b) => a + Math.max(b, 0), 0),
    rows: [],
    unassignable: [],
    notRegistered: list.rows.map((r) => r.login_id),
  };
  for (const st of shuffle([...students.rows])) {
    const mine = busy.get(st.id) ?? new Set<string>();
    const acted = done.get(st.id) ?? new Set<number>();
    const missing = slotInfo.filter((p) => !mine.has(`${p.day_id}:${p.id}`));
    if (missing.length) plan.students++;
    plan.slots += missing.length;
    for (const p of missing) {
      const key = `${p.day_id}:${p.id}`;
      if (mine.has(key)) continue; // già coperto da una sessione lunga assegnata poco fa
      // candidati: sessioni che coprono questo blocco, con posti, tutti i cui blocchi sono liberi; si preferiscono quelle più vuote
      const cand = shuffle(sessions.rows.filter(
        (s) => s.day === p.day_id && (s.blocks as number[]).includes(p.id) && free.get(s.id)! > 0 && !acted.has(s.act) &&
          (s.blocks as number[]).every((b) => !mine.has(`${s.day}:${b}`)),
      )).sort((a, b) => free.get(b.id)! - free.get(a.id)!);
      const s = cand[0];
      if (!s) {
        plan.unassignable.push({ user: st.name, day: p.day ?? 'giorno da definire', block: p.name });
        continue;
      }
      free.set(s.id, free.get(s.id)! - 1);
      for (const b of s.blocks as number[]) mine.add(`${s.day}:${b}`);
      acted.add(s.act);
      plan.rows.push({ userId: st.id, sessionId: s.id });
    }
  }
  return plan;
}

// Applica il piano in una transazione. Con non assegnabili serve `allowPartial` (conferma esplicita): mai assegnamenti parziali in silenzio.
export async function applyAssign(pool: Pool, allowPartial: boolean): Promise<Plan> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Blocca iscrizioni e annullamenti mentre si assegna.
    await client.query('LOCK TABLE enrollments IN SHARE ROW EXCLUSIVE MODE');
    // Stesso lock di updateMine: nessuna modifica del massimo mentre si calcola il piano.
    await client.query(`SELECT 1 FROM activities WHERE school_year_id = (SELECT id FROM school_years WHERE is_current) AND status = 'approvata' FOR UPDATE`);
    const state = (await client.query('SELECT enrollment_state s FROM school_years WHERE is_current')).rows[0].s;
    if (state !== 'chiuse') throw new Error('L\'assegnazione casuale si fa a iscrizioni chiuse.');
    const plan = await buildPlan(client);
    if (plan.unassignable.length && !allowPartial) {
      throw new Error(`${plan.unassignable.length} posti non assegnabili (posti insufficienti): guarda l'elenco nell'anteprima e conferma l'assegnazione parziale.`);
    }
    for (const r of plan.rows) {
      await client.query('INSERT INTO enrollments (user_id, session_id, assigned) VALUES ($1, $2, true)', [r.userId, r.sessionId]);
    }
    await client.query('COMMIT');
    return plan;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Annulla in blocco tutte le assegnazioni casuali dell'anno corrente.
// Solo a iscrizioni chiuse (come l'assegnazione) e mai le iscrizioni con presenza già segnata.
export async function undoAssign(pool: Pool): Promise<number> {
  if ((await pool.query('SELECT enrollment_state s FROM school_years WHERE is_current')).rows[0].s !== 'chiuse') {
    throw new Error('Le assegnazioni si annullano a iscrizioni chiuse.');
  }
  const { rowCount } = await pool.query('DELETE FROM enrollments WHERE assigned AND present IS NULL AND school_year_id = (SELECT id FROM school_years WHERE is_current)');
  return rowCount ?? 0;
}

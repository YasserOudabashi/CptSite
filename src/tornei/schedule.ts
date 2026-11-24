import { Pool, PoolClient } from 'pg';
import { Tournament, User, canManage, getTournament } from './service';

type SM = { id: number; stage: string; round: number; pos: number; home: number | null; away: number | null };

// Assegnazione automatica: i turni si giocano in ordine (gironi prima, poi eliminazione), in ogni orario tante partite quanti i campi,
// mai una squadra due volte nello stesso orario, arbitri a rotazione senza doppioni nello stesso orario.
export function autoSchedule(matches: SM[], fieldCount: number, refereeIds: number[], minutes: number, pause: number) {
  const sorted = [...matches].sort((a, b) => (a.stage === b.stage ? 0 : a.stage === 'girone' ? -1 : 1) || a.round - b.round || a.pos - b.pos || a.id - b.id);
  const out: { id: number; field: number; offset: number; referee: number | null }[] = [];
  let slot = 0;
  let refPtr = 0;
  const keys = [...new Set(sorted.map((m) => `${m.stage}:${m.round}`))];
  for (const k of keys) {
    let left = sorted.filter((m) => `${m.stage}:${m.round}` === k);
    while (left.length) {
      const busy = new Set<number>();
      const refs = new Set<number>();
      let field = 0;
      const rest: SM[] = [];
      for (const m of left) {
        if (field < fieldCount && !(m.home && busy.has(m.home)) && !(m.away && busy.has(m.away))) {
          if (m.home) busy.add(m.home);
          if (m.away) busy.add(m.away);
          let referee: number | null = null;
          for (let i = 0; i < refereeIds.length && referee === null; i++) {
            const cand = refereeIds[(refPtr + i) % refereeIds.length];
            if (!refs.has(cand)) {
              referee = cand;
              refs.add(cand);
              refPtr = (refPtr + i + 1) % refereeIds.length;
            }
          }
          out.push({ id: m.id, field: field++, offset: slot * (minutes + pause), referee });
        } else rest.push(m);
      }
      left = rest;
      slot++;
    }
  }
  return out;
}

export type Slot = { id: number; field: number | null; start: number | null; home: number | null; away: number | null; referee: number | null };

// Blocca: stesso campo, stessa squadra o stesso arbitro in orari che si sovrappongono (durata uguale per tutte le partite).
export function findConflict(others: Slot[], c: Slot, minutes: number, names: (id: number) => string = (id) => `#${id}`): string | null {
  if (c.start == null) return null;
  const len = minutes * 60000;
  for (const o of others) {
    if (o.id === c.id || o.start == null || !(o.start < c.start + len && c.start < o.start + len)) continue;
    if (c.field != null && c.field === o.field) return 'Il campo è già occupato a quell\'ora da un\'altra partita.';
    for (const t of [c.home, c.away]) if (t != null && (t === o.home || t === o.away)) return `La squadra ${names(t)} ha già un\'altra partita a quell\'ora.`;
    if (c.referee != null && c.referee === o.referee) return 'L\'arbitro ha già un\'altra partita a quell\'ora.';
  }
  return null;
}

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SQL_AT = `($1::timestamp AT TIME ZONE 'Europe/Zurich')`;

async function slotsOf(pool: Pool | PoolClient, tid: number): Promise<Slot[]> {
  return (
    await pool.query<Slot>(
      `SELECT id, field_id AS field, (extract(epoch from starts_at) * 1000)::float8 AS start, home_id AS home, away_id AS away, referee_id AS referee
       FROM tournament_matches WHERE tournament_id = $1 AND status <> 'annullata'`,
      [tid],
    )
  ).rows;
}

async function guard(pool: Pool, user: User, tid: number): Promise<Tournament> {
  const t = await getTournament(pool, tid);
  if (!t || !(await canManage(pool, user, tid))) throw new Error('Non puoi modificare questo torneo.');
  if (t.status !== 'in corso') throw new Error('Gli orari si assegnano a calendario generato, con il torneo in corso.');
  return t;
}

// Campi e orari automatici da una data/ora di inizio (ora di Zurigo), durata partita del torneo e pausa tra partite.
export async function autoAssign(pool: Pool, user: User, tid: number, start: string, pause: number): Promise<number> {
  const t = await guard(pool, user, tid);
  if (!LOCAL.test(start)) throw new Error('Data e ora di inizio non valide.');
  if (!Number.isInteger(pause) || pause < 0 || pause > 240) throw new Error('Pausa non valida (0–240 minuti).');
  const fields = (await pool.query<{ id: number }>('SELECT id FROM tournament_fields WHERE tournament_id = $1 ORDER BY id', [tid])).rows;
  if (!fields.length) throw new Error('Aggiungi almeno un campo nella gestione del torneo.');
  const refs = (await pool.query<{ user_id: number }>('SELECT user_id FROM tournament_referees WHERE tournament_id = $1 ORDER BY user_id', [tid])).rows.map((r) => r.user_id);
  const client = await pool.connect();
  let plan: ReturnType<typeof autoSchedule> = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE', [tid]);
    // Solo le partite non ancora programmate: orari, rinvii e partite giocate non si toccano.
    const { rows } = await client.query<SM>(
      `SELECT id, stage, round, pos, home_id AS home, away_id AS away FROM tournament_matches WHERE tournament_id = $1 AND status = 'da giocare' AND starts_at IS NULL`,
      [tid],
    );
    plan = autoSchedule(rows, fields.length, refs, t.match_minutes, pause);
    // Campi, squadre e arbitri delle partite già programmate (anche in corso o finite) restano occupati: si sposta il blocco in avanti finché non c'è conflitto.
    const existing = (await slotsOf(client, tid)).filter((s) => s.start != null);
    const startMs = (await client.query<{ ms: number }>(`SELECT (extract(epoch from ${SQL_AT}) * 1000)::float8 AS ms`, [start])).rows[0].ms;
    const step = t.match_minutes + pause;
    let shift = 0;
    const clash = (sh: number) =>
      plan.some((p) => {
        const m = rows.find((r) => r.id === p.id)!;
        return findConflict(existing, { id: p.id, field: fields[p.field].id, start: startMs + (p.offset + sh * step) * 60000, home: m.home, away: m.away, referee: p.referee }, t.match_minutes) !== null;
      });
    while (existing.length && plan.length && clash(shift) && shift < 2000) shift++;
    for (const p of plan) {
      await client.query(
        `UPDATE tournament_matches SET field_id = $2, referee_id = $3, starts_at = (($4::timestamp + $5 * interval '1 minute') AT TIME ZONE 'Europe/Zurich') WHERE id = $1`,
        [p.id, fields[p.field].id, p.referee, start, p.offset + shift * step],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return plan.length;
}

// Modifica manuale di campo, orario e arbitro; un nuovo orario su una partita già programmata richiede il motivo (rinvio).
type EditBody = { field?: string; start?: string; referee?: string; reason?: string };
// Transazione con il torneo bloccato: due modifiche simultanee non possono creare conflitti di campo, squadra o arbitro.
export async function editMatch(pool: Pool, user: User, tid: number, matchId: number, b: EditBody): Promise<string> {
  const t = await guard(pool, user, tid);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE', [tid]);
    await editMatchTx(client, t, tid, matchId, b);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const warn = (await gaWarnings(pool, tid)).get(matchId);
  return warn ? `Salvato. Attenzione: ${warn.join('; ')}` : 'Salvato.';
}

async function editMatchTx(client: PoolClient, t: Tournament, tid: number, matchId: number, b: EditBody): Promise<void> {
  const m = (await client.query<{ id: number; home_id: number | null; away_id: number | null; status: string; starts_at: Date | null }>('SELECT id, home_id, away_id, status, starts_at FROM tournament_matches WHERE id = $1 AND tournament_id = $2', [matchId, tid])).rows[0];
  if (!m) throw new Error('Partita non trovata.');
  if (m.status === 'finita') throw new Error('La partita è finita: non si cambia più l\'orario.');
  const field = Number(b.field) || null;
  const referee = Number(b.referee) || null;
  if (field && !(await client.query('SELECT 1 FROM tournament_fields WHERE id = $1 AND tournament_id = $2', [field, tid])).rowCount) throw new Error('Campo non valido.');
  if (referee && !(await client.query('SELECT 1 FROM tournament_referees WHERE user_id = $1 AND tournament_id = $2', [referee, tid])).rowCount) throw new Error('L\'arbitro non è assegnato a questo torneo.');
  const local = (b.start ?? '').trim();
  if (local && !LOCAL.test(local)) throw new Error('Data e ora non valide.');
  const start = local ? (await client.query<{ ms: number }>(`SELECT (extract(epoch from ${SQL_AT}) * 1000)::float8 AS ms`, [local])).rows[0].ms : null;
  const cand: Slot = { id: matchId, field, start, home: m.home_id, away: m.away_id, referee };
  const names = new Map((await client.query<{ id: number; name: string }>('SELECT id, name FROM tournament_teams WHERE tournament_id = $1', [tid])).rows.map((r) => [r.id, r.name]));
  const bad = findConflict(await slotsOf(client, tid), cand, t.match_minutes, (id) => names.get(id) ?? '?');
  if (bad) throw new Error(bad);
  const moved = m.starts_at != null && start != null && m.starts_at.getTime() !== start;
  const reason = (b.reason ?? '').trim();
  if (moved && !reason) throw new Error('La partita era già programmata: scrivi il motivo del rinvio.');
  await client.query(
    `UPDATE tournament_matches SET field_id = $2, referee_id = $3, starts_at = ($4::timestamp AT TIME ZONE 'Europe/Zurich'), postponed_reason = $5 WHERE id = $1`,
    [matchId, field, referee, local || null, moved ? reason : null],
  );
}

// Avviso (non blocco): giocatori della partita con un'attività GA nello stesso orario.
export async function gaWarnings(pool: Pool, tid: number): Promise<Map<number, string[]>> {
  const { rows } = await pool.query<{ match_id: number; who: string; title: string }>(
    `SELECT DISTINCT m.id AS match_id, u.first_name || ' ' || u.last_name AS who, a.title
     FROM tournament_matches m
     JOIN tournaments t ON t.id = m.tournament_id
     JOIN tournament_members tm ON tm.team_id IN (m.home_id, m.away_id) AND tm.confirmed
     JOIN users u ON u.id = tm.user_id
     JOIN enrollments e ON e.user_id = tm.user_id
     JOIN activity_sessions s ON s.id = e.session_id
     JOIN activities a ON a.id = e.activity_id
     JOIN ga_days d ON d.id = s.ga_day_id
     JOIN time_blocks b1 ON b1.id = s.start_block_id
     JOIN LATERAL (SELECT max(x.end_time) AS end_time FROM (SELECT end_time FROM time_blocks WHERE kind = 'blocco' AND position >= b1.position ORDER BY position LIMIT s.block_count) x) l ON true
     WHERE m.tournament_id = $1 AND m.starts_at IS NOT NULL AND d.day IS NOT NULL
       AND d.day + b1.start_time < (m.starts_at AT TIME ZONE 'Europe/Zurich') + t.match_minutes * interval '1 minute'
       AND d.day + l.end_time > (m.starts_at AT TIME ZONE 'Europe/Zurich')`,
    [tid],
  );
  const out = new Map<number, string[]>();
  for (const r of rows) out.set(r.match_id, [...(out.get(r.match_id) ?? []), `${r.who} ha l'attività GA "${r.title}" nello stesso orario`]);
  return out;
}

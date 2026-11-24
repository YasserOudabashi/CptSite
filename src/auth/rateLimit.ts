import { Pool } from 'pg';

export const MAX_ATTEMPTS_PER_HOUR = 5;
export const ipLimitPerHour = () => Number(process.env.RATE_LIMIT_IP_PER_HOUR) || 300;

// Registra il tentativo PRIMA di controllare e conta dopo l'INSERT (conta anche il proprio): con richieste parallele
// passano al massimo `limit` tentativi, perché ognuno vede tutti gli INSERT già confermati prima del proprio conteggio.
// Torna true se un limite è superato, più gli id delle righe inserite (per annullare il proprio tentativo in caso di successo).
export async function hit(pool: Pool, keys: [kind: string, key: string, limit: number][]): Promise<{ blocked: boolean; undo: () => Promise<void> }> {
  const ids: number[] = [];
  for (const [kind, key] of keys) {
    ids.push((await pool.query('INSERT INTO registration_attempts (kind, key) VALUES ($1, $2) RETURNING id', [kind, key])).rows[0].id);
  }
  let blocked = false;
  for (const [kind, key, limit] of keys) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM registration_attempts WHERE kind = $1 AND key = $2 AND created_at > now() - interval '1 hour'`,
      [kind, key],
    );
    if (rows[0].n > limit) blocked = true;
  }
  return { blocked, undo: async () => void (await pool.query('DELETE FROM registration_attempts WHERE id = ANY($1::int[])', [ids])) };
}

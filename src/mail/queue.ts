import { Pool, PoolClient } from 'pg';
import { fromAddress, getTransport } from './transport';

const MAX_ATTEMPTS = 3;
const QUEUE_LOCK_KEY = 703001; // lock consultivo: un solo processo svuota la coda alla volta

export function batchSize(): number {
  return Math.max(1, Number(process.env.MAIL_BATCH_SIZE ?? 50));
}

// Massimo di destinatari al giorno (limite del fornitore SMTP).
export function dailyLimit(): number {
  return Math.max(1, Number(process.env.MAIL_DAILY_LIMIT ?? 500));
}

export interface QueueResult {
  sent: number;
  errors: number;
  pending: number;
  dailyLimitReached: boolean;
}

// Destinatari già serviti oggi (giorno di calendario svizzero).
async function sentToday(client: PoolClient, now: Date): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mail_queue
     WHERE status = 'sent'
       AND sent_at >= (date_trunc('day', $1::timestamptz AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich')`,
    [now],
  );
  return rows[0].n;
}

// Invia i lotti in attesa finché c'è coda e non si supera il limite giornaliero.
// Chiamata dal worker periodico: il giorno dopo riprende da sola.
export async function processMailQueue(pool: Pool, now: Date = new Date()): Promise<QueueResult> {
  const result: QueueResult = { sent: 0, errors: 0, pending: 0, dailyLimitReached: false };
  const client = await pool.connect();
  try {
    const { rows: lock } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [QUEUE_LOCK_KEY]);
    if (!lock[0].ok) return result;
    try {
      for (;;) {
        const remaining = dailyLimit() - (await sentToday(client, now));
        if (remaining <= 0) {
          result.dailyLimitReached = true;
          break;
        }

        const { rows: batch } = await client.query<{
          id: number; recipient: string; attempts: number; subject: string; body: string;
        }>(
          `SELECT q.id, q.recipient, q.attempts, j.subject, j.body
           FROM mail_queue q JOIN mail_jobs j ON j.id = q.job_id
           WHERE q.status = 'pending'
             AND q.job_id = (SELECT job_id FROM mail_queue WHERE status = 'pending' ORDER BY id LIMIT 1)
           ORDER BY q.id
           LIMIT $1`,
          [Math.min(batchSize(), remaining)],
        );
        if (batch.length === 0) break;

        const ids = batch.map((r) => r.id);
        try {
          // Copia nascosta: i destinatari non si vedono tra loro.
          await getTransport().send({
            to: fromAddress(),
            bcc: batch.map((r) => r.recipient),
            subject: batch[0].subject,
            text: batch[0].body,
          });
          await client.query(
            `UPDATE mail_queue SET status = 'sent', sent_at = $2, attempts = attempts + 1, last_error = NULL
             WHERE id = ANY($1)`,
            [ids, now],
          );
          result.sent += batch.length;
        } catch (err) {
          await client.query(
            `UPDATE mail_queue
             SET attempts = attempts + 1, last_error = $2,
                 status = CASE WHEN attempts + 1 >= $3 THEN 'error' ELSE 'pending' END
             WHERE id = ANY($1)`,
            [ids, err instanceof Error ? err.message : String(err), MAX_ATTEMPTS],
          );
          result.errors += batch.length;
          break; // SMTP in errore: si riprova al prossimo giro del worker
        }
      }
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM mail_queue WHERE status = 'pending'`,
      );
      result.pending = rows[0].n;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [QUEUE_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return result;
}

// Svuota la coda periodicamente (default ogni 10 minuti). Restituisce la funzione per fermarlo.
export function startMailWorker(pool: Pool, intervalMs = 10 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    processMailQueue(pool).catch((err) => console.error('Coda mail:', err));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export interface MailJobLog {
  id: number;
  kind: string;
  subject: string;
  created_at: Date;
  sent: number;
  pending: number;
  errors: number;
  recipients: { recipient: string; status: string; attempts: number; last_error: string | null; sent_at: Date | null }[];
}

// Registro degli invii a lotti (per il Responsabile GA): chi ha ricevuto e gli errori.
export async function getMailLog(pool: Pool): Promise<MailJobLog[]> {
  const { rows: jobs } = await pool.query(
    `SELECT j.id, j.kind, j.subject, j.created_at,
            count(*) FILTER (WHERE q.status = 'sent')::int AS sent,
            count(*) FILTER (WHERE q.status = 'pending')::int AS pending,
            count(*) FILTER (WHERE q.status = 'error')::int AS errors
     FROM mail_jobs j LEFT JOIN mail_queue q ON q.job_id = j.id
     GROUP BY j.id ORDER BY j.created_at DESC, j.id DESC`,
  );
  const { rows: recipients } = await pool.query(
    `SELECT job_id, recipient, status, attempts, last_error, sent_at FROM mail_queue ORDER BY recipient`,
  );
  return jobs.map((j) => ({
    ...j,
    recipients: recipients
      .filter((r) => r.job_id === j.id)
      .map(({ job_id: _, ...r }) => r),
  }));
}

// Le sole tre mail che il sito invia. Tutte le altre (relatori, avvisi) si mandano a mano.
import { Pool } from 'pg';
import { getTransport, MailSendError } from './transport';
import { processMailQueue, QueueResult } from './queue';
import { getCurrentSchoolYear } from '../users/roles';

export { MailSendError } from './transport';

const SITE_NAME = 'Portale CPT Trevano';

async function sendNow(to: string, subject: string, text: string): Promise<void> {
  try {
    await getTransport().send({ to, subject, text });
  } catch (err) {
    throw new MailSendError(err);
  }
}

// Codice personale di registrazione (valido 24 ore).
// Il chiamante salva il codice solo dopo che questa funzione è riuscita
// (o in una transazione annullata se lancia MailSendError).
export async function sendPersonalCode(to: string, code: string): Promise<void> {
  await sendNow(
    to,
    `${SITE_NAME}: il tuo codice personale`,
    `Ciao,\n\nil tuo codice personale per completare la registrazione è:\n\n    ${code}\n\n` +
      `Il codice vale 24 ore. Se non hai chiesto tu la registrazione, ignora questa mail.\n`,
  );
}

// Codice di recupero password (monouso, valido 30 minuti). Stessa regola di sendPersonalCode.
export async function sendPasswordReset(to: string, code: string): Promise<void> {
  await sendNow(
    to,
    `${SITE_NAME}: recupero password`,
    `Ciao,\n\nil codice per scegliere una nuova password è:\n\n    ${code}\n\n` +
      `Il codice vale 30 minuti e si usa una sola volta. Se non l'hai chiesto tu, ignora questa mail.\n`,
  );
}

export interface EnrollmentOpenResult extends QueueResult {
  jobId: number;
  recipients: number;
}

// Avviso di apertura delle iscrizioni GA a tutti gli allievi e docenti registrati.
// Mette in coda un destinatario per riga e invia subito i primi lotti; il resto lo invia il worker.
export async function sendEnrollmentOpen(
  pool: Pool,
  opts: { createdBy?: number } = {},
): Promise<EnrollmentOpenResult> {
  const year = await getCurrentSchoolYear(pool);
  const siteUrl = process.env.SITE_URL ? `\n\n${process.env.SITE_URL}` : '';
  const client = await pool.connect();
  let jobId: number;
  let recipients: number;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO mail_jobs (kind, subject, body, school_year_id, created_by)
       VALUES ('enrollment_open', $1, $2, $3, $4) RETURNING id`,
      [
        `${SITE_NAME}: iscrizioni alle Giornate Autogestite aperte`,
        `Ciao,\n\nle iscrizioni alle Giornate Autogestite ${year.name} sono aperte.\n` +
          `Entra nel sito e scegli le tue attività: i posti sono limitati.${siteUrl}\n`,
        year.id,
        opts.createdBy ?? null,
      ],
    );
    jobId = rows[0].id;
    // Registrati = password già scelta.
    const inserted = await client.query(
      `INSERT INTO mail_queue (job_id, recipient)
       SELECT DISTINCT $1::int, lower(u.login_id)
       FROM users u JOIN user_roles r ON r.user_id = u.id
       WHERE r.role_code IN ('allievo', 'docente') AND u.password_hash IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [jobId],
    );
    recipients = inserted.rowCount ?? 0;
    await client.query('UPDATE school_years SET enrollment_mail_sent_at = now() WHERE id = $1', [year.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const result = await processMailQueue(pool);
  return { jobId, recipients, ...result };
}

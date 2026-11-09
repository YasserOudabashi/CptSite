import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createTestDb } from './helpers/db';
import * as mail from '../src/mail';
import { sendPersonalCode, sendPasswordReset, sendEnrollmentOpen, MailSendError } from '../src/mail';
import { FakeTransport, getTransport, setTransport } from '../src/mail/transport';
import { processMailQueue, getMailLog } from '../src/mail/queue';
import { assignRole, type RoleCode } from '../src/users/roles';

let pool: Pool;
let stopDb: () => Promise<void>;
let fake: FakeTransport;

async function addUser(loginId: string, role: RoleCode, registered = true): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO users (login_id, first_name, last_name, password_hash) VALUES ($1, 'N', 'C', $2) RETURNING id`,
    [loginId, registered ? 'hash' : null],
  );
  await assignRole(pool, rows[0].id, role);
}

before(async () => {
  const db = await createTestDb();
  pool = db.pool;
  stopDb = db.stop;
  for (let i = 1; i <= 7; i++) await addUser(`all${i}@studenti.edu.ti.ch`, 'allievo');
  await addUser('doc1@samtrevano.ch', 'docente');
  await addUser('rel1@example.ch', 'relatore'); // non riceve
  await addUser('nonreg@studenti.edu.ti.ch', 'allievo', false); // password non scelta: non riceve
});

after(async () => {
  await stopDb();
});

beforeEach(async () => {
  fake = new FakeTransport();
  setTransport(fake);
  process.env.MAIL_BATCH_SIZE = '3';
  process.env.MAIL_DAILY_LIMIT = '1000';
  await pool.query('DELETE FROM mail_jobs');
});

test('il modulo espone solo le tre funzioni di invio', () => {
  const fns = Object.entries(mail).filter(([, v]) => typeof v === 'function').map(([k]) => k);
  assert.deepEqual(fns.filter((k) => k !== 'MailSendError').sort(), [
    'sendEnrollmentOpen',
    'sendPasswordReset',
    'sendPersonalCode',
  ]);
});

test('in test il trasporto è quello finto', () => {
  setTransport(undefined as never);
  assert.ok(getTransport() instanceof FakeTransport);
});

test('codice personale e recupero password arrivano al destinatario', async () => {
  await sendPersonalCode('all1@studenti.edu.ti.ch', 'ABC123');
  await sendPasswordReset('all1@studenti.edu.ti.ch', 'XYZ789');
  assert.equal(fake.outbox.length, 2);
  assert.equal(fake.outbox[0].to, 'all1@studenti.edu.ti.ch');
  assert.match(fake.outbox[0].text, /ABC123/);
  assert.match(fake.outbox[1].text, /XYZ789/);
});

test('errore SMTP: MailSendError con messaggio chiaro', async () => {
  fake.failNext = 1;
  await assert.rejects(sendPersonalCode('x@studenti.edu.ti.ch', 'C1'), (err: unknown) => {
    assert.ok(err instanceof MailSendError);
    assert.match((err as Error).message, /Invio e-mail non riuscito/);
    return true;
  });
  assert.equal(fake.outbox.length, 0);
});

test('apertura iscrizioni: allievi e docenti registrati, copia nascosta, a lotti', async () => {
  const res = await sendEnrollmentOpen(pool);
  assert.equal(res.recipients, 8); // 7 allievi + 1 docente
  assert.equal(res.sent, 8);
  assert.equal(res.pending, 0);
  assert.deepEqual(fake.outbox.map((m) => m.bcc!.length), [3, 3, 2]);
  const all = fake.outbox.flatMap((m) => m.bcc!);
  assert.ok(all.includes('doc1@samtrevano.ch'));
  assert.ok(!all.includes('rel1@example.ch'));
  assert.ok(!all.includes('nonreg@studenti.edu.ti.ch'));
  assert.ok(fake.outbox.every((m) => !m.to || !m.bcc!.includes(m.to)));
});

test('limite giornaliero: si ferma e riprende da solo il giorno dopo', async () => {
  process.env.MAIL_DAILY_LIMIT = '5';
  const res = await sendEnrollmentOpen(pool);
  // Primo giro (oggi): 5 inviati, 3 restano in coda.
  assert.equal(res.sent, 5);
  assert.equal(res.pending, 3);
  assert.equal(res.dailyLimitReached, true);

  // Ancora oggi: niente da fare.
  const again = await processMailQueue(pool);
  assert.equal(again.sent, 0);
  assert.equal(again.dailyLimitReached, true);

  // Il giorno dopo il worker riprende.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const next = await processMailQueue(pool, tomorrow);
  assert.equal(next.sent, 3);
  assert.equal(next.pending, 0);
  assert.equal(fake.outbox.flatMap((m) => m.bcc!).length, 8);
});

test('registro: errori SMTP registrati, poi ritentati', async () => {
  fake.failNext = 1;
  const res = await sendEnrollmentOpen(pool);
  assert.equal(res.errors, 3);
  assert.equal(res.sent, 0);

  let [job] = await getMailLog(pool);
  assert.equal(job.pending, 8);
  const failed = job.recipients.filter((r) => r.last_error);
  assert.equal(failed.length, 3);
  assert.match(failed[0].last_error!, /simulato/);

  await processMailQueue(pool);
  [job] = await getMailLog(pool);
  assert.equal(job.sent, 8);
  assert.equal(job.errors, 0);
  assert.ok(job.recipients.every((r) => r.status === 'sent' && r.sent_at));
});

test('dopo 3 tentativi falliti il destinatario resta in errore', async () => {
  fake.failNext = 3;
  await sendEnrollmentOpen(pool);
  await processMailQueue(pool);
  await processMailQueue(pool);
  const [job] = await getMailLog(pool);
  assert.equal(job.errors, 3);
  // Gli altri lotti continuano.
  await processMailQueue(pool);
  const [after] = await getMailLog(pool);
  assert.equal(after.sent, 5);
  assert.equal(after.errors, 3);
});

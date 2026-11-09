-- Coda degli invii a lotti (mail di apertura iscrizioni) e registro destinatari.

CREATE TABLE mail_jobs (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                     -- 'enrollment_open'
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una riga per destinatario: è anche il registro di chi ha ricevuto e degli errori.
CREATE TABLE mail_queue (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES mail_jobs(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE (job_id, recipient)
);

CREATE INDEX mail_queue_pending ON mail_queue (id) WHERE status = 'pending';
CREATE INDEX mail_queue_sent_at ON mail_queue (sent_at) WHERE status = 'sent';

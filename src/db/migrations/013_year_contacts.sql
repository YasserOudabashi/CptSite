-- Relatori e docenti "contatti" di un anno scolastico anche senza attività (riproposti dall'anno precedente, US-029).
CREATE TABLE year_contacts (
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_year_id, user_id)
);

-- Elenco ID allievi (facoltativo, per anno scolastico) e impostazioni del sito.

CREATE TABLE student_ids (
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  login_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX student_ids_unique ON student_ids (school_year_id, lower(login_id));

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

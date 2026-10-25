-- Utenti, ruoli (molti-a-molti) e anni scolastici.

CREATE TABLE school_years (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,              -- es. '2026-2027'
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Al massimo un anno corrente (il seed garantisce che ce ne sia uno).
CREATE UNIQUE INDEX school_years_one_current ON school_years (is_current) WHERE is_current;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  login_id TEXT NOT NULL,                 -- ID allievo o e-mail (docente/relatore)
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  class_name TEXT,                        -- solo allievi
  password_hash TEXT,                     -- NULL finché la password non è scelta
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_login_id_unique ON users (lower(login_id));

CREATE TABLE roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT INTO roles (code, name) VALUES
  ('allievo', 'Allievo'),
  ('docente', 'Docente'),
  ('relatore', 'Relatore'),
  ('resp_ga', 'Responsabile GA'),
  ('resp_sito', 'Responsabile sito');

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES roles(code),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

-- Seed: anno scolastico corrente.
INSERT INTO school_years (name, is_current) VALUES ('2026-2027', true);

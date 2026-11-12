-- Registrazione allievi, passo 1: codici personali in attesa e tentativi (limite orario).

CREATE TABLE registration_codes (
  id SERIAL PRIMARY KEY,
  login_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo codice in attesa per ID: una nuova richiesta sostituisce la precedente.
CREATE UNIQUE INDEX registration_codes_login ON registration_codes (lower(login_id));

CREATE TABLE registration_attempts (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,          -- 'id' oppure 'ip'
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX registration_attempts_lookup ON registration_attempts (kind, key, created_at);

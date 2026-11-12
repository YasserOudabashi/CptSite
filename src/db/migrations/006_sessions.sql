-- Login: sessioni lato server (token salvato hashato) e tentativi di login falliti.

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE login_failures (
  id SERIAL PRIMARY KEY,
  login_id TEXT NOT NULL,       -- minuscolo
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_failures_lookup ON login_failures (login_id, created_at);

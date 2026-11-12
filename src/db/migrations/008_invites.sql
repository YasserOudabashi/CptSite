-- Inviti di docenti e relatori: link monouso (nel DB solo lo sha256 del token), scadenza 14 giorni.

CREATE TABLE invites (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role_code TEXT NOT NULL REFERENCES roles(code),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

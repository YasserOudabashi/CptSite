-- Attività GA, sessioni (ogni volta che l'attività si svolge) e iscrizioni, per anno scolastico.

CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER CHECK (capacity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_name_unique ON rooms (lower(name));

CREATE TABLE activities (
  id SERIAL PRIMARY KEY,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  organizer_id INTEGER NOT NULL REFERENCES users(id),
  contact TEXT NOT NULL DEFAULT '',            -- telefono (l'e-mail è già nell'utente)
  room_id INTEGER REFERENCES rooms(id),
  duration_blocks INTEGER NOT NULL DEFAULT 1 CHECK (duration_blocks >= 1),
  repetitions INTEGER NOT NULL DEFAULT 1 CHECK (repetitions IN (1, 2)),
  ga_day_id INTEGER REFERENCES ga_days(id),   -- giorno scelto dal proponente (NULL = da decidere)
  first_block_id INTEGER REFERENCES time_blocks(id),
  second_block_id INTEGER REFERENCES time_blocks(id),
  materials TEXT NOT NULL DEFAULT '',
  min_participants INTEGER NOT NULL DEFAULT 0 CHECK (min_participants >= 0),
  max_participants INTEGER NOT NULL CHECK (max_participants >= 1),
  status TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta', 'approvata', 'rifiutata')),
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_participants <= max_participants),
  CHECK (first_block_id IS NULL OR second_block_id IS NULL OR first_block_id <> second_block_id)
);
CREATE INDEX activities_year_status ON activities (school_year_id, status);

-- Una riga per ogni volta che l'attività si svolge (1 o 2 ripetizioni).
CREATE TABLE activity_sessions (
  id SERIAL PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  repeat_no INTEGER NOT NULL DEFAULT 1 CHECK (repeat_no IN (1, 2)),
  ga_day_id INTEGER NOT NULL REFERENCES ga_days(id),
  start_block_id INTEGER NOT NULL REFERENCES time_blocks(id),
  block_count INTEGER NOT NULL DEFAULT 1 CHECK (block_count >= 1),
  UNIQUE (activity_id, repeat_no)
);

CREATE TABLE enrollments (
  id SERIAL PRIMARY KEY,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,  -- impostato dal trigger
  assigned BOOLEAN NOT NULL DEFAULT false,   -- true = assegnata a caso (US-023)
  present BOOLEAN,                           -- presenze (US-024)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id)              -- una sola sessione della stessa attività
);
CREATE INDEX enrollments_session ON enrollments (session_id);

-- Blocchi occupati da ogni iscrizione (una riga per blocco, anche per le sessioni lunghe):
-- l'unicità (utente, giorno, blocco) impedisce due impegni nello stesso momento.
CREATE TABLE enrollment_blocks (
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ga_day_id INTEGER NOT NULL REFERENCES ga_days(id),
  block_id INTEGER NOT NULL REFERENCES time_blocks(id),
  PRIMARY KEY (enrollment_id, block_id),
  UNIQUE (user_id, ga_day_id, block_id)
);

CREATE FUNCTION enrollments_fill() RETURNS trigger AS $$
DECLARE
  s activity_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM activity_sessions WHERE id = NEW.session_id;
  SELECT a.school_year_id INTO NEW.school_year_id FROM activities a WHERE a.id = s.activity_id;
  NEW.activity_id := s.activity_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollments_fill_trg BEFORE INSERT ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enrollments_fill();

-- Dopo l'inserimento registra i block_count blocchi (kind 'blocco') a partire da quello iniziale.
CREATE FUNCTION enrollments_blocks() RETURNS trigger AS $$
BEGIN
  INSERT INTO enrollment_blocks (enrollment_id, user_id, ga_day_id, block_id)
  SELECT NEW.id, NEW.user_id, s.ga_day_id, b.id
  FROM activity_sessions s
  JOIN time_blocks st ON st.id = s.start_block_id
  JOIN LATERAL (
    SELECT id FROM time_blocks
    WHERE kind = 'blocco' AND position >= st.position
    ORDER BY position LIMIT s.block_count
  ) b ON true
  WHERE s.id = NEW.session_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollments_blocks_trg AFTER INSERT ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enrollments_blocks();

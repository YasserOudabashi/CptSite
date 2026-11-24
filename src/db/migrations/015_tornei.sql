-- Tornei (Fase 6): indipendenti da GA, per anno scolastico. Lo sport è un'etichetta libera.
INSERT INTO roles (code, name) VALUES ('resp_tornei', 'Responsabile tornei');

CREATE TABLE tournaments (
  id SERIAL PRIMARY KEY,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,   -- attività GA collegata (facoltativa)
  created_by INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  sport TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'squadre' CHECK (mode IN ('squadre', 'singoli')),
  team_min INTEGER NOT NULL DEFAULT 1 CHECK (team_min >= 1),
  team_max INTEGER NOT NULL DEFAULT 1 CHECK (team_max >= 1),
  format TEXT NOT NULL DEFAULT 'girone' CHECK (format IN ('girone', 'eliminazione', 'gironi_eliminazione')),
  double_round BOOLEAN NOT NULL DEFAULT false,            -- girone: andata e ritorno
  groups_count INTEGER NOT NULL DEFAULT 2 CHECK (groups_count >= 1),
  qualifiers INTEGER NOT NULL DEFAULT 2 CHECK (qualifiers >= 1),   -- qualificate per girone
  score_type TEXT NOT NULL DEFAULT 'punti' CHECK (score_type IN ('punti', 'set')),
  best_of INTEGER NOT NULL DEFAULT 3 CHECK (best_of >= 1 AND best_of % 2 = 1),
  pts_win INTEGER NOT NULL DEFAULT 3,
  pts_draw INTEGER NOT NULL DEFAULT 1,
  pts_loss INTEGER NOT NULL DEFAULT 0,
  forfeit_score INTEGER NOT NULL DEFAULT 3 CHECK (forfeit_score >= 0),   -- punteggio della vittoria a tavolino
  tiebreaks TEXT NOT NULL DEFAULT 'punti,scontro_diretto,differenza,fatti,sorteggio',
  match_minutes INTEGER NOT NULL DEFAULT 30 CHECK (match_minutes > 0),
  max_teams INTEGER NOT NULL DEFAULT 16 CHECK (max_teams >= 2),
  status TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza', 'iscrizioni', 'in corso', 'concluso')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (team_min <= team_max)
);
CREATE INDEX tournaments_year ON tournaments (school_year_id, status);

CREATE TABLE tournament_organizers (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE TABLE tournament_referees (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE TABLE tournament_fields (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (tournament_id, name)
);
CREATE TABLE tournament_groups (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE tournament_teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  captain_id INTEGER REFERENCES users(id),
  approved BOOLEAN NOT NULL DEFAULT false,     -- l'organizzatore accetta la squadra anche se non ha il numero di giocatori richiesto
  seed_no INTEGER,                             -- testa di serie (scelta a mano)
  group_id INTEGER REFERENCES tournament_groups(id) ON DELETE SET NULL,
  draw_no INTEGER,                             -- sorteggio (ultimo spareggio)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tournament_teams_name ON tournament_teams (tournament_id, lower(name));

-- tournament_id ripetuto qui per imporre dal database "una sola squadra per torneo".
CREATE TABLE tournament_members (
  team_id INTEGER NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, user_id),
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE tournament_matches (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('girone', 'eliminazione')),
  group_id INTEGER REFERENCES tournament_groups(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  home_id INTEGER REFERENCES tournament_teams(id) ON DELETE SET NULL,
  away_id INTEGER REFERENCES tournament_teams(id) ON DELETE SET NULL,
  home_src TEXT,                               -- origine dello slot vuoto: 'G<gruppo>:<posizione>'
  away_src TEXT,
  next_match_id INTEGER REFERENCES tournament_matches(id) ON DELETE SET NULL,
  next_slot TEXT CHECK (next_slot IN ('home', 'away')),
  field_id INTEGER REFERENCES tournament_fields(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ,
  referee_id INTEGER REFERENCES users(id),
  postponed_reason TEXT,
  status TEXT NOT NULL DEFAULT 'da giocare' CHECK (status IN ('da giocare', 'in corso', 'finita', 'annullata')),
  home_score INTEGER,
  away_score INTEGER,
  sets TEXT,                                   -- punteggi dei set, es. '25-20,20-25,15-10'
  winner_id INTEGER REFERENCES tournament_teams(id) ON DELETE SET NULL,
  forfeit BOOLEAN NOT NULL DEFAULT false,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX tournament_matches_t ON tournament_matches (tournament_id);

CREATE TABLE tournament_match_events (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('gol', 'giallo', 'rosso'))
);

-- Ogni correzione di un risultato: chi, quando, valore precedente.
CREATE TABLE tournament_result_log (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous TEXT NOT NULL
);

-- Tempo reale: notifica 'tornei_live' con l'id del torneo a ogni cambio di partite o squadre.
CREATE FUNCTION tornei_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('tornei_live', COALESCE(NEW.tournament_id, OLD.tournament_id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tournament_matches_notify AFTER INSERT OR UPDATE OR DELETE ON tournament_matches
  FOR EACH ROW EXECUTE FUNCTION tornei_notify();
CREATE TRIGGER tournament_teams_notify AFTER INSERT OR UPDATE OR DELETE ON tournament_teams
  FOR EACH ROW EXECUTE FUNCTION tornei_notify();

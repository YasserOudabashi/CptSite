-- Blocchi orari (modificabili) e date delle GA (anche "da definire").

CREATE TABLE time_blocks (
  id SERIAL PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'blocco' CHECK (kind IN ('blocco', 'pausa')),  -- 'pausa' = pausa o pranzo, non scegliibile
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);

-- Orari definitivi decisi alla riunione GA del 22.10.
INSERT INTO time_blocks (position, name, kind, start_time, end_time) VALUES
  (1, 'Blocco 1', 'blocco', '08:30', '10:00'),
  (2, 'Pausa', 'pausa', '10:00', '10:15'),
  (3, 'Blocco 2', 'blocco', '10:15', '11:45'),
  (4, 'Pranzo', 'pausa', '11:45', '12:45'),
  (5, 'Blocco 3', 'blocco', '12:45', '14:15'),
  (6, 'Pausa', 'pausa', '14:15', '14:30'),
  (7, 'Blocco 4', 'blocco', '14:30', '16:00');

-- Giorni delle GA per anno; day NULL = "da definire".
CREATE TABLE ga_days (
  id SERIAL PRIMARY KEY,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id),
  day DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

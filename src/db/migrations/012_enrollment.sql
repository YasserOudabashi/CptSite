-- Iscrizioni: stato per anno, blocchi occupati da ogni sessione, e blocco delle modifiche che romperebbero enrollment_blocks.

ALTER TABLE school_years
  ADD COLUMN enrollment_state TEXT NOT NULL DEFAULT 'chiuse' CHECK (enrollment_state IN ('solo_organizzatori', 'aperte', 'chiuse')),
  ADD COLUMN enrollment_mail_sent_at TIMESTAMPTZ;

-- Blocchi (kind 'blocco') coperti da ogni sessione, giorno compreso: stessa logica di enrollments_blocks().
CREATE VIEW session_blocks AS
SELECT s.id AS session_id, s.ga_day_id, b.id AS block_id
FROM activity_sessions s
JOIN time_blocks st ON st.id = s.start_block_id
JOIN LATERAL (
  SELECT id FROM time_blocks WHERE kind = 'blocco' AND position >= st.position ORDER BY position LIMIT s.block_count
) b ON true;

-- enrollment_blocks si calcola solo all'INSERT: sessione, utente, giorno e blocchi non si spostano con un UPDATE.
CREATE FUNCTION enrollments_forbid_move() RETURNS trigger AS $$
BEGIN
  IF NEW.session_id <> OLD.session_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'Una iscrizione non si sposta: va annullata e rifatta.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION sessions_forbid_move() RETURNS trigger AS $$
BEGIN
  IF NEW.start_block_id <> OLD.start_block_id OR NEW.block_count <> OLD.block_count OR NEW.ga_day_id <> OLD.ga_day_id THEN
    RAISE EXCEPTION 'Giorno e blocchi di una sessione non si cambiano.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollments_forbid_move BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION enrollments_forbid_move();
CREATE TRIGGER sessions_forbid_move BEFORE UPDATE ON activity_sessions FOR EACH ROW EXECUTE FUNCTION sessions_forbid_move();

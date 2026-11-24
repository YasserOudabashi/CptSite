-- Fix revisione Fase 6: tempo reale anche per eventi e membri; il forfait vale almeno 1.
CREATE TRIGGER tournament_match_events_notify AFTER INSERT OR UPDATE OR DELETE ON tournament_match_events
  FOR EACH ROW EXECUTE FUNCTION tornei_notify();
CREATE TRIGGER tournament_members_notify AFTER INSERT OR UPDATE OR DELETE ON tournament_members
  FOR EACH ROW EXECUTE FUNCTION tornei_notify();

UPDATE tournaments SET forfeit_score = 1 WHERE forfeit_score < 1;
ALTER TABLE tournaments DROP CONSTRAINT tournaments_forfeit_score_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_forfeit_score_check CHECK (forfeit_score >= 1);

-- Notifica "ga_seats" quando cambiano iscrizioni, sessioni o attività: la pagina /attivita (SSE) si aggiorna.
CREATE FUNCTION ga_seats_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('ga_seats', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollments_notify AFTER INSERT OR DELETE ON enrollments
  FOR EACH STATEMENT EXECUTE FUNCTION ga_seats_notify();
CREATE TRIGGER sessions_notify AFTER INSERT OR DELETE ON activity_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION ga_seats_notify();
CREATE TRIGGER activities_notify AFTER UPDATE ON activities
  FOR EACH STATEMENT EXECUTE FUNCTION ga_seats_notify();

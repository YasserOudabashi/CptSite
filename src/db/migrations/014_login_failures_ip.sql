-- Il blocco login conta per (ID, IP): chi sbaglia da un IP non blocca l'ID per tutti.
ALTER TABLE login_failures ADD COLUMN ip TEXT NOT NULL DEFAULT '';

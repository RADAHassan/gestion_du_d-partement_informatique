-- Migration 002 : index complémentaires (exemple de migration incrémentale).
-- Le schéma initial (schema.sql) constitue la migration 001.
-- Appliquer : psql "$DATABASE_URL" -f database/migrations/002_index_complementaires.sql
CREATE INDEX IF NOT EXISTS reservations_salle_debut_idx ON reservations (salle_id, debut);
CREATE INDEX IF NOT EXISTS mouvements_equipement_idx ON mouvements_stock (equipement_id, created_at DESC);

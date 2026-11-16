-- Migration 003 : notifications, pannes, paramètres, statut de présence « retard »,
-- alerte de retard de retour du matériel.
-- Appliquer sur une base existante (sans perdre les données) :
--   docker compose exec -T db psql -U dept_admin -d dept_info < database/migrations/003_notifications_pannes_parametres.sql
-- (une base neuve créée avec schema.sql contient déjà tout cela)
BEGIN;

ALTER TABLE presences DROP CONSTRAINT IF EXISTS presences_statut_check;
ALTER TABLE presences ADD CONSTRAINT presences_statut_check
  CHECK (statut IN ('present', 'retard', 'absent', 'absent_justifie'));

ALTER TABLE demandes_materiel ADD COLUMN IF NOT EXISTS retard_notifie BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     VARCHAR(500) NOT NULL,
  lu          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, lu, created_at DESC);

CREATE TABLE IF NOT EXISTS pannes (
  id             SERIAL PRIMARY KEY,
  equipement_id  INT REFERENCES equipements(id) ON DELETE CASCADE,
  salle_id       INT REFERENCES salles(id) ON DELETE CASCADE,
  signale_par    INT REFERENCES users(id) ON DELETE SET NULL,
  description    VARCHAR(500) NOT NULL,
  statut         VARCHAR(10) NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'resolue')),
  resolue_par    INT REFERENCES users(id) ON DELETE SET NULL,
  resolue_le     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pannes_cible CHECK (equipement_id IS NOT NULL OR salle_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS pannes_statut_idx ON pannes (statut, created_at DESC);

CREATE TABLE IF NOT EXISTS parametres (
  cle          VARCHAR(60) PRIMARY KEY,
  valeur       VARCHAR(100) NOT NULL,
  description  VARCHAR(255) NOT NULL DEFAULT ''
);
INSERT INTO parametres (cle, valeur, description) VALUES
  ('pointage_minutes', '15', 'Durée de validité du code de pointage (minutes)'),
  ('retard_minutes',   '5',  'Au-delà de ce délai après l''ouverture, un pointage est marqué « en retard » (minutes)'),
  ('seuil_absences',   '3',  'Nombre d''absences non justifiées déclenchant une alerte au chef de département')
ON CONFLICT (cle) DO NOTHING;

COMMIT;

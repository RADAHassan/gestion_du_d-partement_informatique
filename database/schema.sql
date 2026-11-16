-- =====================================================================
-- FST Tanger - Gestion du département informatique
-- Schéma PostgreSQL (idempotent : recrée le schéma public)
-- =====================================================================
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- contraintes d'exclusion (anti-chevauchement)
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- hachage bcrypt des comptes de test

-- ---------------------------------------------------------------------
-- Structure pédagogique
-- ---------------------------------------------------------------------
CREATE TABLE cycles (
  id   SERIAL PRIMARY KEY,
  nom  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE filieres (
  id        SERIAL PRIMARY KEY,
  nom       VARCHAR(100) NOT NULL,
  cycle_id  INT NOT NULL REFERENCES cycles(id) ON DELETE RESTRICT,
  UNIQUE (nom, cycle_id)
);

CREATE TABLE groupes (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(100) NOT NULL,
  filiere_id  INT NOT NULL REFERENCES filieres(id) ON DELETE RESTRICT,
  UNIQUE (nom, filiere_id)
);

-- ---------------------------------------------------------------------
-- Utilisateurs
-- ---------------------------------------------------------------------
CREATE TYPE role_t AS ENUM ('admin', 'enseignant', 'etudiant');

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  nom            VARCHAR(100) NOT NULL,
  prenom         VARCHAR(100) NOT NULL,
  role           role_t NOT NULL,
  groupe_id      INT REFERENCES groupes(id) ON DELETE RESTRICT,
  actif          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_etudiant_groupe CHECK (role <> 'etudiant' OR groupe_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_groupe_idx ON users (groupe_id);

-- ---------------------------------------------------------------------
-- Salles, séances, réservations
-- ---------------------------------------------------------------------
CREATE TABLE salles (
  id        SERIAL PRIMARY KEY,
  nom       VARCHAR(100) NOT NULL UNIQUE,
  type      VARCHAR(20) NOT NULL DEFAULT 'cours' CHECK (type IN ('cours', 'tp', 'amphi')),
  capacite  INT NOT NULL CHECK (capacite > 0),
  actif     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE seances (
  id                SERIAL PRIMARY KEY,
  module            VARCHAR(150) NOT NULL,
  enseignant_id     INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  groupe_id         INT NOT NULL REFERENCES groupes(id) ON DELETE RESTRICT,
  salle_id          INT REFERENCES salles(id) ON DELETE RESTRICT,
  debut             TIMESTAMPTZ NOT NULL,
  fin               TIMESTAMPTZ NOT NULL,
  statut            VARCHAR(20) NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'annulee', 'terminee')),
  presence_validee  BOOLEAN NOT NULL DEFAULT FALSE,
  transmise_le      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seances_periode CHECK (fin > debut),
  -- Une séance annulée libère la salle / l'enseignant / le groupe (WHERE statut <> 'annulee')
  CONSTRAINT seances_no_overlap_salle EXCLUDE USING gist
    (salle_id WITH =, tstzrange(debut, fin) WITH &&) WHERE (statut <> 'annulee'),
  CONSTRAINT seances_no_overlap_enseignant EXCLUDE USING gist
    (enseignant_id WITH =, tstzrange(debut, fin) WITH &&) WHERE (statut <> 'annulee'),
  CONSTRAINT seances_no_overlap_groupe EXCLUDE USING gist
    (groupe_id WITH =, tstzrange(debut, fin) WITH &&) WHERE (statut <> 'annulee')
);
CREATE INDEX seances_debut_idx ON seances (debut);
CREATE INDEX seances_enseignant_idx ON seances (enseignant_id);
CREATE INDEX seances_groupe_idx ON seances (groupe_id);

CREATE TABLE reservations (
  id             SERIAL PRIMARY KEY,
  salle_id       INT NOT NULL REFERENCES salles(id) ON DELETE RESTRICT,
  enseignant_id  INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  debut          TIMESTAMPTZ NOT NULL,
  fin            TIMESTAMPTZ NOT NULL,
  motif          VARCHAR(255) NOT NULL DEFAULT '',
  statut         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'annulee')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reservations_periode CHECK (fin > debut),
  CONSTRAINT reservations_no_overlap EXCLUDE USING gist
    (salle_id WITH =, tstzrange(debut, fin) WITH &&) WHERE (statut = 'active')
);
CREATE INDEX reservations_enseignant_idx ON reservations (enseignant_id);

-- ---------------------------------------------------------------------
-- Matériel & stock
-- ---------------------------------------------------------------------
CREATE TABLE equipements (
  id         SERIAL PRIMARY KEY,
  nom        VARCHAR(150) NOT NULL UNIQUE,
  categorie  VARCHAR(100) NOT NULL DEFAULT 'general',
  type       VARCHAR(20) NOT NULL CHECK (type IN ('durable', 'consommable')),
  -- durable : nombre d'unités possédées ; consommable : stock courant
  quantite   INT NOT NULL DEFAULT 0 CHECK (quantite >= 0),
  seuil_min  INT NOT NULL DEFAULT 0 CHECK (seuil_min >= 0),
  actif      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE demandes_materiel (
  id             SERIAL PRIMARY KEY,
  equipement_id  INT NOT NULL REFERENCES equipements(id) ON DELETE RESTRICT,
  enseignant_id  INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  quantite       INT NOT NULL CHECK (quantite > 0),
  debut          TIMESTAMPTZ NOT NULL,
  fin            TIMESTAMPTZ NOT NULL,
  motif          VARCHAR(255) NOT NULL DEFAULT '',
  statut         VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                 CHECK (statut IN ('en_attente', 'validee', 'refusee', 'annulee', 'retournee')),
  traite_par     INT REFERENCES users(id),
  traite_le      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT demandes_periode CHECK (fin >= debut)
);
CREATE INDEX demandes_equipement_idx ON demandes_materiel (equipement_id, statut);

CREATE TABLE mouvements_stock (
  id             SERIAL PRIMARY KEY,
  equipement_id  INT NOT NULL REFERENCES equipements(id) ON DELETE CASCADE,
  type           VARCHAR(10) NOT NULL CHECK (type IN ('entree', 'sortie')),
  quantite       INT NOT NULL CHECK (quantite > 0),
  motif          VARCHAR(255) NOT NULL DEFAULT '',
  user_id        INT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alertes_stock (
  id             SERIAL PRIMARY KEY,
  equipement_id  INT NOT NULL REFERENCES equipements(id) ON DELETE CASCADE,
  quantite       INT NOT NULL,
  seuil_min      INT NOT NULL,
  message        VARCHAR(255) NOT NULL,
  resolue        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolue_le     TIMESTAMPTZ
);
-- au plus une alerte active par équipement
CREATE UNIQUE INDEX alertes_active_uq ON alertes_stock (equipement_id) WHERE NOT resolue;

-- ---------------------------------------------------------------------
-- Pointage & absences
-- ---------------------------------------------------------------------
CREATE TABLE pointages (
  id         SERIAL PRIMARY KEY,
  seance_id  INT NOT NULL UNIQUE REFERENCES seances(id) ON DELETE CASCADE,
  code       VARCHAR(10) NOT NULL,
  ouvert_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expire_le  TIMESTAMPTZ NOT NULL,
  statut     VARCHAR(10) NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'cloture')),
  cloture_le TIMESTAMPTZ
);
CREATE INDEX pointages_code_idx ON pointages (code) WHERE statut = 'ouvert';

CREATE TABLE presences (
  id           SERIAL PRIMARY KEY,
  seance_id    INT NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  etudiant_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statut       VARCHAR(20) NOT NULL CHECK (statut IN ('present', 'absent', 'absent_justifie')),
  source       VARCHAR(10) NOT NULL DEFAULT 'etudiant' CHECK (source IN ('etudiant', 'auto', 'manuel')),
  pointe_le    TIMESTAMPTZ,
  UNIQUE (seance_id, etudiant_id)
);
CREATE INDEX presences_etudiant_idx ON presences (etudiant_id);

CREATE TABLE justificatifs (
  id             SERIAL PRIMARY KEY,
  presence_id    INT NOT NULL REFERENCES presences(id) ON DELETE CASCADE,
  etudiant_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fichier        VARCHAR(255) NOT NULL,
  nom_original   VARCHAR(255) NOT NULL,
  mime           VARCHAR(100) NOT NULL,
  motif          VARCHAR(500) NOT NULL DEFAULT '',
  statut         VARCHAR(20) NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'valide', 'refuse')),
  commentaire    VARCHAR(500),
  traite_par     INT REFERENCES users(id),
  traite_le      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX justificatifs_statut_idx ON justificatifs (statut);

-- ---------------------------------------------------------------------
-- Journal d'activité
-- ---------------------------------------------------------------------
CREATE TABLE journal (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(80) NOT NULL,
  entite      VARCHAR(60),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX journal_created_idx ON journal (created_at DESC);

-- =====================================================================
-- Jeu de données de test
-- Mots de passe (bcrypt via pgcrypto) :
--   admin@fsttanger.ma      -> Admin@1234
--   prof1@fsttanger.ma ...  -> Prof@1234
--   etudiant1@etu.fsttanger.ma ... -> Etud@1234
-- =====================================================================

INSERT INTO cycles (nom) VALUES ('Licence'), ('Master'), ('Cycle Ingénieur');

INSERT INTO filieres (nom, cycle_id) VALUES
  ('LST Informatique',        (SELECT id FROM cycles WHERE nom = 'Licence')),
  ('Master Data Science',     (SELECT id FROM cycles WHERE nom = 'Master')),
  ('Génie Informatique',      (SELECT id FROM cycles WHERE nom = 'Cycle Ingénieur'));

INSERT INTO groupes (nom, filiere_id) VALUES
  ('G1', (SELECT id FROM filieres WHERE nom = 'LST Informatique')),
  ('G2', (SELECT id FROM filieres WHERE nom = 'LST Informatique')),
  ('G1', (SELECT id FROM filieres WHERE nom = 'Master Data Science'));

-- Utilisateurs ---------------------------------------------------------
INSERT INTO users (email, password_hash, nom, prenom, role) VALUES
  ('admin@fsttanger.ma', crypt('Admin@1234', gen_salt('bf', 10)), 'Alaoui', 'Karim', 'admin'),
  ('prof1@fsttanger.ma', crypt('Prof@1234',  gen_salt('bf', 10)), 'Benani', 'Samira', 'enseignant'),
  ('prof2@fsttanger.ma', crypt('Prof@1234',  gen_salt('bf', 10)), 'El Idrissi', 'Youssef', 'enseignant'),
  ('prof3@fsttanger.ma', crypt('Prof@1234',  gen_salt('bf', 10)), 'Tazi', 'Nadia', 'enseignant');

INSERT INTO users (email, password_hash, nom, prenom, role, groupe_id)
SELECT 'etudiant' || n || '@etu.fsttanger.ma',
       crypt('Etud@1234', gen_salt('bf', 10)),
       (ARRAY['Amrani','Bennis','Chraibi','Daoudi','Fassi','Gharbi'])[n],
       (ARRAY['Aya','Bilal','Chaima','Driss','Fatima','Ghita'])[n],
       'etudiant',
       (SELECT g.id FROM groupes g JOIN filieres f ON f.id = g.filiere_id
         WHERE f.nom = 'LST Informatique' AND g.nom = CASE WHEN n <= 4 THEN 'G1' ELSE 'G2' END)
FROM generate_series(1, 6) AS n;

-- Salles ---------------------------------------------------------------
INSERT INTO salles (nom, type, capacite) VALUES
  ('Amphi A',      'amphi', 200),
  ('Salle 101',    'cours', 40),
  ('Salle 102',    'cours', 40),
  ('Labo Info 1',  'tp',    30),
  ('Labo Info 2',  'tp',    30);

-- Matériel -------------------------------------------------------------
INSERT INTO equipements (nom, categorie, type, quantite, seuil_min) VALUES
  ('Vidéoprojecteur portable', 'audiovisuel', 'durable', 2, 0),
  ('Ordinateur portable',      'informatique', 'durable', 5, 0),
  ('Câble HDMI',               'accessoire',   'durable', 10, 0),
  ('Cartouche d''encre',       'bureautique',  'consommable', 8, 3),
  ('Ramette papier A4',        'bureautique',  'consommable', 20, 5),
  ('Clé USB 32 Go',            'informatique', 'consommable', 4, 5);

-- Clé USB déjà sous le seuil minimal => alerte initiale
INSERT INTO alertes_stock (equipement_id, quantite, seuil_min, message)
SELECT id, quantite, seuil_min, 'Stock sous le seuil minimal : ' || nom || ' (' || quantite || ' < ' || seuil_min || ')'
FROM equipements WHERE nom = 'Clé USB 32 Go';

INSERT INTO mouvements_stock (equipement_id, type, quantite, motif, user_id)
SELECT e.id, 'entree', e.quantite, 'Stock initial', (SELECT id FROM users WHERE role = 'admin')
FROM equipements e WHERE e.type = 'consommable';

-- Séances ---------------------------------------------------------------
-- (dates relatives à "aujourd'hui" pour que la démo reste pertinente)
INSERT INTO seances (module, enseignant_id, groupe_id, salle_id, debut, fin, statut, presence_validee, transmise_le)
SELECT v.module,
       (SELECT id FROM users WHERE email = v.prof),
       (SELECT g.id FROM groupes g JOIN filieres f ON f.id = g.filiere_id WHERE f.nom = 'LST Informatique' AND g.nom = v.groupe),
       (SELECT id FROM salles WHERE nom = v.salle),
       date_trunc('day', now()) + v.d * interval '1 day' + v.h1 * interval '1 hour',
       date_trunc('day', now()) + v.d * interval '1 day' + v.h2 * interval '1 hour',
       v.statut, v.valide, CASE WHEN v.valide THEN now() - interval '1 day' END
FROM (VALUES
  ('Algorithmique (hier)',        'prof1@fsttanger.ma', 'G1', 'Salle 101',   -1,  8.0, 10.0, 'terminee',  TRUE),
  ('Bases de données (hier)',     'prof2@fsttanger.ma', 'G1', 'Labo Info 1', -1, 10.25, 12.25, 'terminee', FALSE),
  ('Système d''exploitation',     'prof1@fsttanger.ma', 'G1', 'Salle 101',    0, 14.0, 16.0, 'planifiee', FALSE),
  ('Algorithmique',               'prof1@fsttanger.ma', 'G1', 'Salle 101',    1,  8.0, 10.0, 'planifiee', FALSE),
  ('Bases de données',            'prof2@fsttanger.ma', 'G1', 'Labo Info 1',  1, 10.25, 12.25, 'planifiee', FALSE),
  ('Réseaux',                     'prof1@fsttanger.ma', 'G2', 'Salle 102',    1, 14.0, 16.0, 'planifiee', FALSE),
  ('Programmation Web',           'prof2@fsttanger.ma', 'G2', 'Labo Info 2',  2,  8.0, 10.0, 'planifiee', FALSE),
  ('Génie logiciel',              'prof3@fsttanger.ma', 'G1', 'Salle 102',    2, 10.25, 12.25, 'planifiee', FALSE)
) AS v(module, prof, groupe, salle, d, h1, h2, statut, valide);

-- Réservation ponctuelle d'amphi par un enseignant
INSERT INTO reservations (salle_id, enseignant_id, debut, fin, motif)
VALUES ((SELECT id FROM salles WHERE nom = 'Amphi A'),
        (SELECT id FROM users WHERE email = 'prof2@fsttanger.ma'),
        date_trunc('day', now()) + interval '1 day 14 hours',
        date_trunc('day', now()) + interval '1 day 16 hours',
        'Conférence invitée');

-- Demandes de matériel --------------------------------------------------
INSERT INTO demandes_materiel (equipement_id, enseignant_id, quantite, debut, fin, motif, statut, traite_par, traite_le)
VALUES
  ((SELECT id FROM equipements WHERE nom = 'Vidéoprojecteur portable'),
   (SELECT id FROM users WHERE email = 'prof1@fsttanger.ma'), 1,
   date_trunc('day', now()) + interval '1 day 8 hours', date_trunc('day', now()) + interval '1 day 10 hours',
   'Cours en salle sans projecteur', 'validee', (SELECT id FROM users WHERE role = 'admin'), now());
INSERT INTO demandes_materiel (equipement_id, enseignant_id, quantite, debut, fin, motif)
VALUES
  ((SELECT id FROM equipements WHERE nom = 'Ordinateur portable'),
   (SELECT id FROM users WHERE email = 'prof2@fsttanger.ma'), 2,
   date_trunc('day', now()) + interval '2 day 8 hours', date_trunc('day', now()) + interval '2 day 10 hours',
   'TP mobile');

-- Présences de la séance validée d'hier ----------------------------------
INSERT INTO pointages (seance_id, code, ouvert_le, expire_le, statut, cloture_le)
SELECT id, 'DEMO01', debut, debut + interval '15 minutes', 'cloture', debut + interval '15 minutes'
FROM seances WHERE module = 'Algorithmique (hier)';

INSERT INTO presences (seance_id, etudiant_id, statut, source, pointe_le)
SELECT s.id, u.id,
       CASE WHEN u.email IN ('etudiant1@etu.fsttanger.ma', 'etudiant3@etu.fsttanger.ma') THEN 'present' ELSE 'absent' END,
       CASE WHEN u.email IN ('etudiant1@etu.fsttanger.ma', 'etudiant3@etu.fsttanger.ma') THEN 'etudiant' ELSE 'auto' END,
       CASE WHEN u.email IN ('etudiant1@etu.fsttanger.ma', 'etudiant3@etu.fsttanger.ma') THEN s.debut + interval '3 minutes' END
FROM seances s JOIN users u ON u.groupe_id = s.groupe_id AND u.role = 'etudiant'
WHERE s.module = 'Algorithmique (hier)';

-- Notifications initiales : l'alerte de stock est signalée au chef de département
INSERT INTO notifications (user_id, message)
SELECT u.id, a.message FROM alertes_stock a CROSS JOIN users u WHERE u.role = 'admin' AND NOT a.resolue;

INSERT INTO journal (user_id, action, entite, details)
VALUES ((SELECT id FROM users WHERE role = 'admin'), 'seed.init', 'systeme', '{"info":"Jeu de données de test chargé"}');

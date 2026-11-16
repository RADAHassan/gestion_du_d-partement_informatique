# Gestion du département informatique — FST Tanger

Application web centralisée pour trois profils : **Chef de département (admin)**, **Enseignant** et **Étudiant**.

Fonctionnalités structurantes (exigences *Must*) :

| Module | Ce que fait l'application |
|---|---|
| **Agenda des salles & réservations** | Saisie des séances par l'admin, consultation des salles libres/occupées sur un créneau, réservation par les enseignants, **refus immédiat (409) en cas de chevauchement**, libération dynamique de la salle à l'annulation d'une séance ou d'une réservation. |
| **Matériel & stock** | Inventaire (durable / consommable), demandes d'emprunt validées par l'admin, **pas de double réservation** (quantité disponible par créneau), entrées/sorties de stock tracées, **alerte automatique sous le seuil minimal**. |
| **Pointage dématérialisé** | L'enseignant ouvre un pointage (code + QR temporaires, 15 min par défaut) → l'étudiant pointe depuis son espace → **clôture automatique** (non-pointés = absents) → correction manuelle, validation par l'enseignant, **transmission au chef de département**. Dépôt (PDF/JPEG/PNG) et validation des justificatifs. |

---

## 1. Architecture

```
┌──────────┐  HTTP   ┌─────────────────────┐  /api   ┌──────────────────┐  SQL   ┌──────────────┐
│ Navigateur│ ──────▶ │ frontend (nginx)    │ ──────▶ │ backend          │ ─────▶ │ db           │
│  React SPA│         │ SPA Vite + Tailwind │         │ Node 20 / Express│        │ PostgreSQL 16│
└──────────┘         └─────────────────────┘         │ JWT · bcrypt·RBAC│        └──────────────┘
                       réseau frontend-net            └──────────────────┘          réseau backend-net
                                                       volume uploads               volume pgdata
```

```
.
├── backend/                API REST Express
│   └── src/
│       ├── app.js          assemblage : helmet, CORS, CSRF, sanitation, routes, erreurs
│       ├── middleware/     auth.js (JWT + RBAC), security.js (CSRF, anti-XSS)
│       ├── routes/         auth, admin, salles, seances (+pointage), materiel, etudiant
│       ├── services/       rules.js (règles pures), conflicts.js, stock.js, pointage.js, journal.js
│       └── utils/          validate.js, errors.js
├── frontend/               React 18 + Vite + Tailwind CSS (pages par rôle)
├── database/
│   ├── schema.sql          tables, contraintes d'intégrité, contraintes d'exclusion anti-chevauchement
│   ├── seed.sql            jeu de données de test (comptes, salles, matériel, séances…)
│   └── migrations/         migrations incrémentales (001 = schema.sql)
├── tests/                  Jest + Supertest : unit/ · integration/ · security/
├── scripts/                backup_db.sh · restore_db.sh · init.sh · crontab.example
├── .github/workflows/      ci-cd.yml
├── docker-compose.yml      db + backend + frontend
└── .env.example
```

### Choix de conception clés

* **Anti-conflit à deux niveaux.** Les réservations/séances sont contrôlées par l'application (verrou consultatif PostgreSQL + vérification, ce qui renvoie un message détaillé) **et** par des contraintes d'exclusion `EXCLUDE USING gist (salle_id WITH =, tstzrange(debut, fin) WITH &&) WHERE (statut <> 'annulee')`. Même deux requêtes simultanées ne peuvent pas créer de doublon. Annuler = passer le statut à `annulee`, ce qui libère immédiatement le créneau.
* **Stock atomique.** Chaque mouvement verrouille la ligne d'équipement (`FOR UPDATE`), met à jour la quantité, journalise le mouvement puis crée/résout l'alerte (une seule alerte active par équipement, déclenchée quand `quantité < seuil_min`).
* **Clôture du pointage.** Un minuteur serveur (30 s) **et** une clôture « paresseuse » à chaque accès garantissent qu'un code expiré n'est jamais accepté et que les non-pointés deviennent absents.
* **RBAC côté serveur.** Le rôle est relu en base à chaque requête (jamais lu dans le jeton) ; un compte désactivé perd l'accès immédiatement.

### Matrice des droits

| Action | Admin | Enseignant | Étudiant |
|---|:-:|:-:|:-:|
| Comptes, cycles, filières, groupes, salles, équipements, stock | ✅ | ❌ 403 | ❌ 403 |
| Planifier des séances | ✅ | ❌ | ❌ |
| Valider demandes de matériel / justificatifs | ✅ | ❌ | ❌ |
| Tableaux de bord, statistiques, journal d'activité | ✅ | ❌ | ❌ |
| Consulter son emploi du temps | ✅ (tout) | ✅ (les siennes) | ✅ (son groupe) |
| Réserver / annuler une salle | annuler | ✅ | ❌ |
| Annuler une séance | ✅ | ✅ (les siennes) | ❌ |
| Demander du matériel | ❌ | ✅ | ❌ |
| Ouvrir/fermer le pointage, corriger, valider la feuille | ❌ | ✅ (ses séances) | ❌ |
| Pointer avec le code, voir ses absences, déposer un justificatif | ❌ | ❌ | ✅ |
| Notifications personnelles, signaler une panne | ✅ | ✅ | ✅ |
| Résoudre une panne, modifier les paramètres (délais, seuils) | ✅ | ❌ 403 | ❌ 403 |
| Statistiques d'absentéisme + export CSV | ✅ (tout) | ✅ (ses séances) | ❌ 403 |

### Mesures de sécurité

* Mots de passe hachés **bcrypt** (coût 10), jamais renvoyés par l'API ; message de login identique pour compte inconnu / mauvais mot de passe ; limitation de débit sur le login et le pointage.
* **JWT** HS256 (algorithme imposé, expiration 8 h), secret obligatoire ≥ 32 caractères en production.
* **Injection SQL** : 100 % de requêtes paramétrées + validation stricte des types.
* **XSS** : balises HTML supprimées à l'entrée, React échappe à l'affichage, en-têtes `helmet` (CSP `default-src 'none'` côté API, CSP côté nginx), `nosniff`.
* **CSRF** : authentification par en-tête `Authorization: Bearer` (aucun cookie d'authentification), rejet des requêtes modifiantes depuis une origine non autorisée, rejet des `Content-Type` de formulaire HTML.
* **Uploads** : PDF/JPEG/PNG, 5 Mo max, vérification de la signature binaire, nom aléatoire, téléchargement réservé au propriétaire et à l'admin.
* Conteneurs non-root, base jamais exposée sur l'hôte, secrets hors du dépôt.

---

## 1 bis. Diagrammes UML

> Diagrammes en Mermaid : ils s'affichent directement sur GitHub. Ils décrivent l'application **telle qu'implémentée** ; les écarts avec le document de conception de l'équipe sont listés dans [docs/CONCEPTION.md](docs/CONCEPTION.md).

### Diagramme de cas d'utilisation

```mermaid
flowchart LR
  A([Chef de département])
  E([Enseignant])
  S([Étudiant])
  P([Planificateur<br/>tâches automatiques])

  subgraph SYS["Système de gestion du département"]
    direction TB
    UC1("S'authentifier")
    UC2("Gérer comptes, cycles, filières, groupes")
    UC3("Gérer salles, équipements, stock")
    UC4("Planifier les séances")
    UC5("Valider ou refuser une demande de matériel")
    UC6("Valider ou refuser un justificatif")
    UC7("Consulter statistiques, exporter, journal")
    UC8("Paramétrer délais et seuils")
    UC9("Consulter salles libres et occupées")
    UC10("Réserver une salle libre")
    UC11("Annuler une séance ou une réservation")
    UC12("Demander du matériel")
    UC13("Ouvrir le pointage, code et QR")
    UC14("Corriger, valider et transmettre la feuille")
    UC15("Consulter son emploi du temps")
    UC16("Pointer avec le code")
    UC17("Consulter ses absences")
    UC18("Déposer un justificatif")
    UC19("Signaler une panne")
    UC20("Consulter ses notifications")
    UC21("Clôturer le pointage, marquer les absents")
    UC22("Alerter : stock, retard de retour, seuil d'absences")
  end

  A --- UC2 & UC3 & UC4 & UC5 & UC6 & UC7 & UC8 & UC11
  E --- UC9 & UC10 & UC11 & UC12 & UC13 & UC14 & UC15 & UC7
  S --- UC15 & UC16 & UC17 & UC18
  A & E & S --- UC1 & UC19 & UC20
  P --- UC21 & UC22
```

### Diagramme de classes

```mermaid
classDiagram
  direction LR
  class Cycle {
    +int id
    +string nom
  }
  class Filiere {
    +int id
    +string nom
  }
  class Groupe {
    +int id
    +string nom
  }
  class User {
    +int id
    +string email
    +string passwordHash
    +string nom
    +string prenom
    +Role role
    +bool actif
  }
  class Salle {
    +int id
    +string nom
    +string type
    +int capacite
    +bool actif
    +estLibre(periode) bool
  }
  class Seance {
    +int id
    +string module
    +timestamptz debut
    +timestamptz fin
    +string statut
    +bool presenceValidee
    +annuler()
    +valider()
  }
  class Reservation {
    +int id
    +timestamptz debut
    +timestamptz fin
    +string motif
    +string statut
    +annuler()
  }
  class Equipement {
    +int id
    +string nom
    +string type
    +int quantite
    +int seuilMin
    +disponible(periode) int
  }
  class DemandeMateriel {
    +int id
    +int quantite
    +timestamptz debut
    +timestamptz fin
    +string statut
    +valider()
    +refuser()
    +retourner()
  }
  class MouvementStock {
    +int id
    +string type
    +int quantite
    +string motif
  }
  class AlerteStock {
    +int id
    +bool resolue
    +string message
  }
  class Pointage {
    +int id
    +string code
    +timestamptz expireLe
    +string statut
    +cloturer()
  }
  class Presence {
    +int id
    +string statut
    +string source
    +timestamptz pointeLe
    +corriger()
  }
  class Justificatif {
    +int id
    +string fichier
    +string statut
    +string commentaire
    +decider()
  }
  class Panne {
    +int id
    +string description
    +string statut
    +resoudre()
  }
  class Notification {
    +int id
    +string message
    +bool lu
  }
  class Journal {
    +int id
    +string action
    +json details
    +string ip
  }
  class Role {
    <<enumeration>>
    admin
    enseignant
    etudiant
  }

  Cycle "1" --> "0..*" Filiere
  Filiere "1" --> "0..*" Groupe
  Groupe "1" --> "0..*" User : étudiants
  User --> Role
  User "1" --> "0..*" Seance : enseigne
  Groupe "1" --> "0..*" Seance : suit
  Salle "1" --> "0..*" Seance : accueille
  Salle "1" --> "0..*" Reservation
  User "1" --> "0..*" Reservation : réserve
  Seance "1" --> "0..1" Pointage
  Seance "1" --> "0..*" Presence
  User "1" --> "0..*" Presence : étudiant
  Presence "1" --> "0..*" Justificatif
  Equipement "1" --> "0..*" DemandeMateriel
  User "1" --> "0..*" DemandeMateriel : enseignant
  Equipement "1" --> "0..*" MouvementStock
  Equipement "1" --> "0..*" AlerteStock
  Equipement "1" --> "0..*" Panne
  Salle "1" --> "0..*" Panne
  User "1" --> "0..*" Panne : signale
  User "1" --> "0..*" Notification
  User "1" --> "0..*" Journal
```

### Diagramme de séquence : pointage, absences et justificatif

```mermaid
sequenceDiagram
  actor P as Enseignant
  actor E as Étudiant
  participant API as API REST
  participant PL as Planificateur
  participant DB as PostgreSQL
  actor A as Chef de département

  P->>API: POST /seances/:id/pointage/ouvrir
  API->>DB: INSERT pointage (code, expire_le = now + durée)
  API-->>P: code + QR
  E->>API: POST /etudiant/pointage {code}
  API->>DB: code ouvert ? non expiré ? groupe de l'étudiant ?
  alt dans le délai
    API->>DB: présence = present
  else après retard_minutes
    API->>DB: présence = retard
  end
  API-->>E: statut enregistré
  PL->>API: échéance atteinte (toutes les 30 s)
  API->>DB: clôture, non-pointés = absent (source auto)
  API->>DB: notifications aux absents
  opt seuil d'absences atteint
    API->>DB: notification au chef de département
  end
  P->>API: POST /seances/:id/valider
  API->>DB: feuille validée et transmise
  API->>DB: notification au chef
  E->>API: POST /etudiant/absences/:id/justificatif
  API->>DB: justificatif en_attente + notification au chef
  A->>API: valider ou refuser
  API->>DB: absent_justifie si validé, notification à l'étudiant
```

### Diagramme de séquence : réservation d'une salle et libération

```mermaid
sequenceDiagram
  actor P as Enseignant
  participant API as API REST
  participant DB as PostgreSQL
  actor P2 as Autre enseignant

  P->>API: POST /reservations (salle, début, fin)
  API->>DB: BEGIN + verrou consultatif sur la salle
  API->>DB: séance ou réservation sur ce créneau ?
  alt créneau libre
    API->>DB: INSERT réservation (contrainte d'exclusion gist)
    API->>DB: COMMIT
    API-->>P: 201 Créée
    API->>DB: notification au chef
  else conflit
    API-->>P: 409 Conflit, salle occupée
  end
  Note over P,DB: Annulation d'une séance
  P->>API: POST /seances/:id/annuler
  API->>DB: statut = annulee (salle libérée immédiatement)
  API->>DB: notification aux étudiants du groupe
  P2->>API: POST /reservations (même créneau)
  API-->>P2: 201 Créée
```

### Diagramme de séquence : demande de matériel et stock

```mermaid
sequenceDiagram
  actor P as Enseignant
  participant API as API REST
  participant DB as PostgreSQL
  actor A as Chef de département

  P->>API: POST /materiel/demandes (équipement, quantité, période)
  API->>DB: verrou sur l'équipement + disponibilité sur la période
  alt indisponible
    API-->>P: 409 Matériel indisponible
  else disponible
    API->>DB: demande en_attente + notification au chef
  end
  A->>API: POST /admin/demandes/:id/valider
  alt équipement durable
    API->>DB: re-vérifie l'absence de double réservation
  else consommable
    API->>DB: mouvement de sortie, stock décrémenté
    opt stock strictement inférieur au seuil
      API->>DB: alerte de stock (une seule) + notification au chef
    end
  end
  API->>DB: notification à l'enseignant
  A->>API: POST /admin/demandes/:id/retour
  API->>DB: statut retournee
```

### Diagrammes d'états

Séance :

```mermaid
stateDiagram-v2
  direction LR
  [*] --> planifiee
  planifiee --> terminee : feuille validée
  planifiee --> annulee : annulation (libère la salle)
```

Pointage :

```mermaid
stateDiagram-v2
  direction LR
  [*] --> ouvert : ouverture par l'enseignant
  ouvert --> cloture : échéance ou clôture manuelle
  cloture --> ouvert : réouverture avant validation
```

Demande de matériel :

```mermaid
stateDiagram-v2
  direction LR
  [*] --> en_attente
  en_attente --> validee : chef valide (disponibilité vérifiée)
  en_attente --> refusee : chef refuse
  en_attente --> annulee : enseignant annule
  validee --> retournee : matériel rendu
  validee --> annulee : enseignant annule (durable)
```

Présence d'un étudiant :

```mermaid
stateDiagram-v2
  direction LR
  [*] --> present : pointage dans le délai
  [*] --> retard : pointage tardif
  [*] --> absent : clôture automatique
  absent --> absent_justifie : justificatif accepté
  absent --> present : correction par l'enseignant
  retard --> present : correction
  present --> retard : correction
```

### Diagramme de déploiement

```mermaid
flowchart LR
  B["Navigateur<br/>SPA React"]
  subgraph DOCKER["Docker Compose"]
    direction LR
    N["frontend<br/>nginx :8080<br/>fichiers statiques + proxy /api"]
    API["backend<br/>Node / Express :4000<br/>non publié sur l'hôte"]
    DB[("db<br/>PostgreSQL 16")]
    V1[("volume pgdata")]
    V2[("volume uploads<br/>justificatifs")]
  end
  B -->|HTTP 8080| N
  N -->|réseau frontend-net| API
  API -->|réseau backend-net, SQL paramétré| DB
  API --> V2
  DB --- V1
```

### Modèle de données (entités-associations)

```mermaid
erDiagram
  CYCLES ||--o{ FILIERES : contient
  FILIERES ||--o{ GROUPES : contient
  GROUPES ||--o{ USERS : etudiants
  USERS ||--o{ SEANCES : enseigne
  GROUPES ||--o{ SEANCES : suit
  SALLES ||--o{ SEANCES : accueille
  SALLES ||--o{ RESERVATIONS : "est reservee"
  USERS ||--o{ RESERVATIONS : effectue
  EQUIPEMENTS ||--o{ DEMANDES_MATERIEL : concerne
  USERS ||--o{ DEMANDES_MATERIEL : demande
  EQUIPEMENTS ||--o{ MOUVEMENTS_STOCK : historise
  EQUIPEMENTS ||--o{ ALERTES_STOCK : declenche
  SEANCES ||--o| POINTAGES : ouvre
  SEANCES ||--o{ PRESENCES : enregistre
  USERS ||--o{ PRESENCES : concerne
  PRESENCES ||--o{ JUSTIFICATIFS : justifie
  USERS ||--o{ NOTIFICATIONS : recoit
  USERS ||--o{ PANNES : signale
  SALLES ||--o{ PANNES : concerne
  EQUIPEMENTS ||--o{ PANNES : concerne
  USERS ||--o{ JOURNAL : agit

  USERS {
    int id PK
    string email UK
    string role
    int groupe_id FK
    bool actif
  }
  SEANCES {
    int id PK
    string module
    timestamptz debut
    timestamptz fin
    string statut
    bool presence_validee
  }
  RESERVATIONS {
    int id PK
    timestamptz debut
    timestamptz fin
    string statut
  }
  EQUIPEMENTS {
    int id PK
    string type
    int quantite
    int seuil_min
  }
  DEMANDES_MATERIEL {
    int id PK
    int quantite
    string statut
    bool retard_notifie
  }
  POINTAGES {
    int id PK
    string code
    timestamptz expire_le
    string statut
  }
  PRESENCES {
    int id PK
    string statut "present, retard, absent, absent_justifie"
    string source
  }
  JUSTIFICATIFS {
    int id PK
    string fichier
    string statut
  }
  PANNES {
    int id PK
    string description
    string statut
  }
  NOTIFICATIONS {
    int id PK
    string message
    bool lu
  }
  PARAMETRES {
    string cle PK
    string valeur
  }
```

---

## 2. Installation rapide avec Docker

Prérequis : Docker ≥ 24 avec Docker Compose v2.

```bash
git clone <url-du-depot> dept-info && cd dept-info

# 1) Crée .env avec JWT_SECRET et mot de passe PostgreSQL aléatoires
bash scripts/init.sh                 # ou manuellement : cp .env.example .env  puis éditer

# 2) Démarre toute la stack
docker compose up --build
```

L'application est disponible sur **http://localhost:8080** (port modifiable via `FRONTEND_PORT`).
Au premier démarrage, PostgreSQL exécute `database/schema.sql` puis `database/seed.sql`.
Pour repartir de zéro : `docker compose down -v` (⚠ supprime les données).

**Mise à jour d'une base Docker déjà créée** (le schéma n'est exécuté qu'à la première création du volume) :
soit `docker compose down -v && docker compose up --build` (repart du jeu de données de test),
soit, pour **conserver les données**, appliquer la migration puis reconstruire :

```bash
docker compose exec -T db psql -U dept_admin -d dept_info < database/migrations/003_notifications_pannes_parametres.sql
docker compose up --build -d
```

> **Production** : retirez la ligne `seed.sql` de `docker-compose.yml` (base vierge), créez ensuite le premier compte admin avec un mot de passe fort, et placez l'application derrière un reverse proxy HTTPS (renseignez alors `CORS_ORIGIN=https://votre-domaine`).

### Développement sans Docker

```bash
# base de données (PostgreSQL 14+ avec extensions btree_gist et pgcrypto)
createdb dept_info && psql dept_info -f database/schema.sql -f database/seed.sql

cd backend  && cp .env.example .env && npm install && npm run dev      # http://localhost:4000
cd frontend && npm install && npm run dev                              # http://localhost:5173 (proxy /api)
```

---

## 3. Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` | `dept_info` / `dept_admin` | Base et utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | — (**obligatoire**) | Mot de passe PostgreSQL |
| `JWT_SECRET` | — (**obligatoire**, ≥ 32 car.) | Secret de signature des jetons (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `8h` | Durée de vie des jetons |
| `POINTAGE_MINUTES` | `15` | Validité par défaut du code de pointage |
| `CORS_ORIGIN` | `http://localhost:8080` | Origine(s) publique(s) autorisée(s), séparées par des virgules (CORS + CSRF) |
| `FRONTEND_PORT` | `8080` | Port publié sur l'hôte |
| `BACKUP_DIR` / `BACKUP_RETENTION_DAYS` | `./backups` / `14` | Dossier et rétention des sauvegardes |
| `DATABASE_URL` | construit par compose | URL PostgreSQL du backend (dev sans Docker) |
| `UPLOAD_DIR` | `/data/uploads` | Stockage des justificatifs (volume `uploads`) |

---

## 4. Comptes de test (jeu de données `seed.sql`)

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Chef de département (admin) | `admin@fsttanger.ma` | `Admin@1234` |
| Enseignant | `prof1@fsttanger.ma` (aussi `prof2@…`, `prof3@…`) | `Prof@1234` |
| Étudiant | `etudiant1@etu.fsttanger.ma` … `etudiant6@etu.fsttanger.ma` | `Etud@1234` |

Les étudiants 1 à 4 sont dans le groupe **G1**, les étudiants 5 et 6 dans **G2** (LST Informatique). Le jeu de données contient 5 salles, 6 équipements (dont une clé USB déjà sous le seuil → alerte), 8 séances autour d'aujourd'hui, une réservation et des demandes de matériel.

> ⚠ Changez ou supprimez ces comptes avant toute mise en production.

**Parcours de démonstration** : connectez-vous en `prof1` → *Emploi du temps* → séance d'aujourd'hui → *Pointage* → *Ouvrir*, notez le code → dans un autre navigateur, `etudiant1` saisit le code → l'enseignant clôture : les autres étudiants sont absents → *Valider & transmettre* → le tableau de bord de l'admin affiche la feuille.

---

## 5. Tests

Les tests (Jest + Supertest) exigent une base PostgreSQL **dédiée et jetable** : le schéma est recréé à chaque fichier de test (`DROP SCHEMA public CASCADE`). **Ne les pointez jamais vers une base réelle.**

```bash
# 1) base de test éphémère
docker run -d --name dept-test-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dept_info_test -p 5432:5432 postgres:16-alpine

# 2) installation et exécution
cd backend && npm ci && cd ../tests && npm ci
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/dept_info_test
npm test                    # tout
npm run test:unit           # règles métier pures (sans base)
npm run test:integration    # salles, matériel & stock, pointage & absences
npm run test:security       # RBAC 403, injection SQL, XSS, CSRF, JWT
```

Couverture principale :

* **Doubles réservations** de salles (chevauchement partiel/total, adjacents OK, concurrence 6 requêtes → 1 succès, contrainte PostgreSQL) et de matériel (validations simultanées jamais sur-réservées, retour/annulation libèrent le stock).
* **Absences à la clôture** : non-pointés → absents, étudiants d'autres groupes ignorés, code expiré refusé et clôture automatique, correction manuelle, validation/transmission.
* **Stock** : décrément automatique, alerte sous le seuil (unique, résolue au réapprovisionnement), refus des sorties excédentaires.
* **Sécurité** : 33 routes admin × (étudiant, enseignant) → `403`, sans jeton → `401`, jetons forgés / `alg:none` / expirés, injections SQL (login, query-string, corps JSON), XSS stocké, CSRF (origine, content-type, cookies), upload falsifié.

---

## 6. Sauvegardes & maintenance

```bash
bash scripts/backup_db.sh                      # dump gzip horodaté : backups/dept_info_AAAAMMJJ_HHMMSS.sql.gz
bash scripts/restore_db.sh backups/<fichier>   # restauration (confirmation demandée)
```

Le script détecte automatiquement le conteneur `db` (Docker Compose) ou utilise `pg_dump` (`DATABASE_URL` / variables `PG*`). Il vérifie l'archive (`gzip -t`), applique la rotation (`BACKUP_RETENTION_DAYS`) et retourne un code ≠ 0 en cas d'échec.

**Planification avec cron** (sauvegarde quotidienne à 02:00) :

```bash
crontab -e
0 2 * * *  cd /opt/dept-info && /usr/bin/env bash scripts/backup_db.sh >> /var/log/dept-info-backup.log 2>&1
```

Un exemple est fourni dans `scripts/crontab.example`. Pensez à copier régulièrement `backups/` hors du serveur et à sauvegarder le volume `uploads` (justificatifs) :
`docker run --rm -v dept-info_uploads:/data -v "$PWD/backups":/out alpine tar czf /out/uploads_$(date +%F).tgz -C /data .`

Mise à jour du schéma : ajoutez un fichier `database/migrations/00N_description.sql` et appliquez-le avec `docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB < database/migrations/00N_….sql`.

---

## 7. CI/CD (GitHub Actions)

`.github/workflows/ci-cd.yml` s'exécute à chaque *push* et *pull request* :

1. **lint** — ESLint backend, frontend et tests ;
2. **test** — PostgreSQL 16 en service, tests unitaires → intégration → sécurité ;
3. **build-frontend** — `vite build` ;
4. **docker** — validation de `docker-compose.yml`, build des images, démarrage de la stack, test de fumée (santé + connexion via nginx) et test du script de sauvegarde ;
5. **publish** — sur `main` uniquement, publication des images `backend` et `frontend` dans GitHub Container Registry (`ghcr.io/<owner>/<repo>/<service>:latest` et `:<sha>`).

---

## 7 bis. Fonctions issues du document de conception UML

| Fonction (UC) | Où |
|---|---|
| Notifications (UC28, EF-17/42) : réservation, annulation de séance, demande de matériel et décision, justificatif déposé/décidé, feuille transmise, absence enregistrée, alerte de stock, panne, retard de retour | `GET /api/notifications`, `/non-lues`, `POST /:id/lue`, `/lues` ; page *Notifications* + compteur dans le menu |
| Statut **retard** (EF-33) : un pointage plus de `retard_minutes` après l'ouverture est marqué « en retard » ; l'enseignant peut le corriger | `presences.statut = 'retard'` |
| Alerte **seuil d'absences** (EF-39) : le chef est prévenu quand un étudiant atteint `seuil_absences` absences non justifiées | `services/pointage.js` |
| Alerte **retard de retour** du matériel (EF-24) : matériel durable validé non rendu après la fin de la période (planificateur, 30 s) | `checkLateReturns()` |
| **Signalement de panne** (UC15, EF-25) par tous les rôles ; résolution par le chef | `GET/POST /api/pannes`, `POST /api/pannes/:id/resoudre` |
| **Statistiques et export** (UC26, EF-37/40) | `GET /api/stats/absences`, `/export` (CSV) |
| **Paramètres** (UC30, EF-45) : durée du code, délai de retard, seuil d'absences | `GET/PUT /api/parametres` ; page *Paramètres* (chef) |

---

## 8. Hypothèses & pistes d'évolution

* Le **QR code** encode le code de séance ; le scan se fait avec n'importe quel lecteur, l'étudiant saisit ensuite le code dans son espace (pas de lien profond).
* « Sous le seuil » = strictement inférieur au seuil minimal.
* Notifications **internes** uniquement (cloche dans le menu) ; le service `backend/src/services/notifications.js` est le point d'entrée où brancher un envoi SMTP (EF-34, EF-42).
* Export des statistiques en **CSV** (séparateur `;`, UTF-8 avec BOM : s'ouvre directement dans Excel) ; l'export PDF reste une évolution.
* Évolutions possibles : import CSV des emplois du temps, export PDF/Excel des feuilles de présence, récurrence des séances, notifications e-mail/push, réinitialisation de mot de passe.

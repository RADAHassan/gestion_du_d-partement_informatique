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

### Mesures de sécurité

* Mots de passe hachés **bcrypt** (coût 10), jamais renvoyés par l'API ; message de login identique pour compte inconnu / mauvais mot de passe ; limitation de débit sur le login et le pointage.
* **JWT** HS256 (algorithme imposé, expiration 8 h), secret obligatoire ≥ 32 caractères en production.
* **Injection SQL** : 100 % de requêtes paramétrées + validation stricte des types.
* **XSS** : balises HTML supprimées à l'entrée, React échappe à l'affichage, en-têtes `helmet` (CSP `default-src 'none'` côté API, CSP côté nginx), `nosniff`.
* **CSRF** : authentification par en-tête `Authorization: Bearer` (aucun cookie d'authentification), rejet des requêtes modifiantes depuis une origine non autorisée, rejet des `Content-Type` de formulaire HTML.
* **Uploads** : PDF/JPEG/PNG, 5 Mo max, vérification de la signature binaire, nom aléatoire, téléchargement réservé au propriétaire et à l'admin.
* Conteneurs non-root, base jamais exposée sur l'hôte, secrets hors du dépôt.

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

## 8. Hypothèses & pistes d'évolution

* Le **QR code** encode le code de séance ; le scan se fait avec n'importe quel lecteur, l'étudiant saisit ensuite le code dans son espace (pas de lien profond).
* « Sous le seuil » = strictement inférieur au seuil minimal.
* Pas de notification e-mail (les alertes et demandes apparaissent dans le tableau de bord admin).
* Évolutions possibles : import CSV des emplois du temps, export PDF/Excel des feuilles de présence, récurrence des séances, notifications e-mail/push, réinitialisation de mot de passe.

#!/usr/bin/env bash
# =====================================================================
# Sauvegarde PostgreSQL : dump SQL compressé (gzip) et horodaté.
#
#   ./scripts/backup_db.sh
#
# Détecte automatiquement le mode :
#   1) Docker Compose (service "db" en cours d'exécution)  -> docker compose exec db pg_dump
#   2) PostgreSQL local/distant via DATABASE_URL ou PG* env  -> pg_dump
#
# Variables (lues aussi dans ./.env) :
#   BACKUP_DIR              dossier de destination      (défaut : ./backups)
#   BACKUP_RETENTION_DAYS   suppression des dumps plus anciens (défaut : 14, 0 = jamais)
# Codes retour : 0 = succès, non nul = échec (adapté à cron / supervision)
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Charge .env sans exécuter son contenu (lecture KEY=VALUE uniquement)
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [[ -z "${!key:-}" ]]; then export "$key=${value%$'\r'}"; fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env)
fi

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
DB_NAME="${POSTGRES_DB:-dept_info}"
DB_USER="${POSTGRES_USER:-dept_admin}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"
TMP="$OUT.partial"

mkdir -p "$BACKUP_DIR"
umask 077   # les dumps contiennent des données personnelles : lisibles par le propriétaire seulement
trap 'rm -f "$TMP"' EXIT

log() { echo "[$(date '+%F %T')] $*"; }

if [[ -z "${DATABASE_URL:-}" ]] && command -v docker >/dev/null 2>&1 \
   && docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  log "Mode Docker Compose : dump de ${DB_NAME}"
  docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges --clean --if-exists | gzip -9 > "$TMP"
elif command -v pg_dump >/dev/null 2>&1; then
  log "Mode pg_dump direct"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists | gzip -9 > "$TMP"
  else
    pg_dump -d "$DB_NAME" -U "$DB_USER" --no-owner --no-privileges --clean --if-exists | gzip -9 > "$TMP"
  fi
else
  log "ERREUR : ni conteneur 'db' en cours d'exécution, ni pg_dump disponible" >&2
  exit 1
fi

# Vérifie l'intégrité de l'archive et qu'elle n'est pas vide
gzip -t "$TMP"
[[ "$(gzip -dc "$TMP" | head -c 1000 | wc -c)" -gt 100 ]] || { log "ERREUR : dump vide" >&2; exit 1; }
mv "$TMP" "$OUT"
log "Sauvegarde créée : $OUT ($(du -h "$OUT" | cut -f1))"

# Rotation
if [[ "$RETENTION" -gt 0 ]]; then
  deleted="$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime "+$RETENTION" -print -delete | wc -l)"
  log "Rotation : $deleted ancienne(s) sauvegarde(s) supprimée(s) (> ${RETENTION} jours)"
fi

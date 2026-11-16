#!/usr/bin/env bash
# Restaure une sauvegarde produite par backup_db.sh.
#   ./scripts/restore_db.sh backups/dept_info_20250101_020000.sql.gz
# ATTENTION : écrase les données actuelles (le dump contient DROP ... IF EXISTS).
set -euo pipefail

FILE="${1:-}"
[[ -f "$FILE" ]] || { echo "Usage : $0 <fichier.sql.gz>" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [[ -z "${!key:-}" ]]; then export "$key=${value%$'\r'}"; fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env)
fi
DB_NAME="${POSTGRES_DB:-dept_info}"
DB_USER="${POSTGRES_USER:-dept_admin}"

read -r -p "Restaurer '$FILE' dans '$DB_NAME' (données actuelles écrasées) ? [oui/NON] " ok
[[ "$ok" == "oui" ]] || { echo "Annulé."; exit 1; }

gzip -t "$FILE"
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  gzip -dc "$FILE" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"
else
  gzip -dc "$FILE" | psql -v ON_ERROR_STOP=1 "${DATABASE_URL:-postgres:///$DB_NAME}"
fi
echo "Restauration terminée."

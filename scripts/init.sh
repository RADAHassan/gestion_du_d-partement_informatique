#!/usr/bin/env bash
# Initialisation du projet : crée .env avec des secrets aléatoires, puis (optionnel) démarre la stack.
#   ./scripts/init.sh          -> prépare .env
#   ./scripts/init.sh --up     -> prépare .env puis docker compose up --build -d
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

rand() { if command -v openssl >/dev/null; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi; }

if [[ -f .env ]]; then
  echo ".env existe déjà : conservé."
else
  cp .env.example .env
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$(rand 32)|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 16)|" .env && rm -f .env.bak
  chmod 600 .env
  echo ".env créé avec un JWT_SECRET et un mot de passe PostgreSQL aléatoires."
fi
mkdir -p backups

if [[ "${1:-}" == "--up" ]]; then
  docker compose up --build -d
  echo "Application : http://localhost:$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2 || echo 8080)"
fi

#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="metakip-postgres-dev"
VOLUME_NAME="metakip-postgres-dev-data"
MEILI_CONTAINER_NAME="metakip-meilisearch-dev"
MEILI_VOLUME_NAME="metakip-meilisearch-dev-data"
ENV_FILE=".env"

# Load credentials from .env if present (typically copied from .env.dev)
DB_USER="metakip"
DB_PASSWORD="password"
DB_NAME="metakip"
MEILI_MASTER_KEY="development-only-meilisearch-master-key-0123456789abcdef"

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      POSTGRES_USER) DB_USER="$value" ;;
      POSTGRES_PASSWORD) DB_PASSWORD="$value" ;;
      POSTGRES_DB) DB_NAME="$value" ;;
      MEILI_MASTER_KEY) MEILI_MASTER_KEY="$value" ;;
    esac
  done < <(grep -v '^#' "$ENV_FILE" | grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|MEILI_MASTER_KEY)=')
fi

MEILI_MASTER_KEY="${MEILI_MASTER_KEY#\"}"
MEILI_MASTER_KEY="${MEILI_MASTER_KEY%\"}"
MEILI_MASTER_KEY="${MEILI_MASTER_KEY#\'}"
MEILI_MASTER_KEY="${MEILI_MASTER_KEY%\'}"
if [ "${#MEILI_MASTER_KEY}" -lt 32 ]; then
  echo "ERROR: MEILI_MASTER_KEY must be at least 32 characters. Copy .env.dev or set a development key."
  exit 1
fi

echo "Starting PostgreSQL dev container..."

# Ensure volume exists
podman volume create "$VOLUME_NAME" >/dev/null 2>&1 || true

# Run container with --replace for idempotency
podman run -d \
  --name "$CONTAINER_NAME" \
  --replace \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -v "$VOLUME_NAME:/var/lib/postgresql/data:Z" \
  -p 5432:5432 \
  --health-cmd="pg_isready -U \"$DB_USER\" -d \"$DB_NAME\"" \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=5 \
  docker.io/library/postgres:17-alpine \
  >/dev/null

echo "Waiting for PostgreSQL to be ready..."
POSTGRES_READY=false
for i in {1..30}; do
  if podman healthcheck run "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "PostgreSQL is ready on localhost:5432 (database: $DB_NAME)"
    POSTGRES_READY=true
    break
  fi
  sleep 1
done

if [ "$POSTGRES_READY" != "true" ]; then
  echo "ERROR: PostgreSQL failed to become healthy within 30 seconds."
  exit 1
fi

echo "Starting Meilisearch dev container..."
podman volume create "$MEILI_VOLUME_NAME" >/dev/null 2>&1 || true
podman run -d \
  --name "$MEILI_CONTAINER_NAME" \
  --replace \
  -e MEILI_ENV=development \
  -e MEILI_MASTER_KEY="$MEILI_MASTER_KEY" \
  -v "$MEILI_VOLUME_NAME:/meili_data:Z" \
  -p 127.0.0.1:7700:7700 \
  docker.io/getmeili/meilisearch:v1.12.8 \
  >/dev/null

echo "Waiting for Meilisearch to be ready..."
for i in {1..30}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:7700/health >/dev/null; then
    echo "Meilisearch is ready on localhost:7700"
    exit 0
  fi
  sleep 1
done

echo "ERROR: Meilisearch failed to become healthy within 30 seconds."
exit 1

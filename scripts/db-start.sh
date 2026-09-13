#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="metakip-postgres-dev"
VOLUME_NAME="metakip-postgres-dev-data"
ENV_FILE=".env"

# Load credentials from .env if present (typically copied from .env.dev)
DB_USER="metakip"
DB_PASSWORD="password"
DB_NAME="metakip"

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      POSTGRES_USER) DB_USER="$value" ;;
      POSTGRES_PASSWORD) DB_PASSWORD="$value" ;;
      POSTGRES_DB) DB_NAME="$value" ;;
    esac
  done < <(grep -v '^#' "$ENV_FILE" | grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=')
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
for i in {1..30}; do
  if podman healthcheck run "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "PostgreSQL is ready on localhost:5432 (database: $DB_NAME)"
    exit 0
  fi
  sleep 1
done

echo "ERROR: PostgreSQL failed to become healthy within 30 seconds."
exit 1

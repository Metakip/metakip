#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="metakip-postgres-dev"
VOLUME_NAME="metakip-postgres-dev-data"
MEILI_CONTAINER_NAME="metakip-meilisearch-dev"
MEILI_VOLUME_NAME="metakip-meilisearch-dev-data"

echo "Resetting dev database and Meilisearch index..."
podman rm -f "$MEILI_CONTAINER_NAME" >/dev/null 2>&1 || true
podman rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
podman volume rm "$MEILI_VOLUME_NAME" >/dev/null 2>&1 || true
podman volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
echo "Dev data reset. Run 'pnpm db:start' to create fresh instances."

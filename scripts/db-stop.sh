#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="metakip-postgres-dev"
MEILI_CONTAINER_NAME="metakip-meilisearch-dev"

echo "Stopping PostgreSQL and Meilisearch dev containers..."
podman stop "$MEILI_CONTAINER_NAME" >/dev/null 2>&1 || true
podman rm "$MEILI_CONTAINER_NAME" >/dev/null 2>&1 || true
podman stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
podman rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
echo "Stopped."

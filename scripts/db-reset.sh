#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="metakip-postgres-dev"
VOLUME_NAME="metakip-postgres-dev-data"

echo "Resetting dev database..."
podman rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
podman volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
echo "Database reset. Run 'pnpm db:start' to create a fresh instance."

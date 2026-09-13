#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="metakip-postgres-dev"

echo "Stopping PostgreSQL dev container..."
podman stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
podman rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
echo "Stopped."

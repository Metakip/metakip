#!/bin/bash
set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-/var/www/metakip}"
SOURCE_CONFIG="${CADDY_SOURCE_CONFIG:-$REPO_DIR/deploy/Caddyfile}"
TARGET_CONFIG="${CADDY_CONFIG_PATH:-/etc/caddy/Caddyfile}"
BACKUP_CONFIG="${TARGET_CONFIG}.backup.$(date -u '+%Y%m%dT%H%M%SZ')"

if [ ! -f "$SOURCE_CONFIG" ]; then
    echo "[ERROR] Caddy source configuration not found: $SOURCE_CONFIG" >&2
    exit 1
fi

echo "[WARNING] This explicitly replaces $TARGET_CONFIG."
echo "[WARNING] Merge any custom domains, routes, headers, and TLS settings first."
sudo caddy validate --config "$SOURCE_CONFIG"

if sudo test -f "$TARGET_CONFIG"; then
    sudo cp -p "$TARGET_CONFIG" "$BACKUP_CONFIG"
    echo "[CADDY] Backup created at $BACKUP_CONFIG"
fi

sudo install -m 0644 "$SOURCE_CONFIG" "$TARGET_CONFIG"

if ! sudo caddy validate --config "$TARGET_CONFIG"; then
    echo "[ERROR] Installed Caddyfile is invalid; restoring the previous configuration." >&2
    if sudo test -f "$BACKUP_CONFIG"; then
        sudo cp -p "$BACKUP_CONFIG" "$TARGET_CONFIG"
    fi
    exit 1
fi

if ! sudo systemctl reload caddy; then
    echo "[ERROR] Caddy reload failed; restoring the previous configuration." >&2
    if sudo test -f "$BACKUP_CONFIG"; then
        sudo cp -p "$BACKUP_CONFIG" "$TARGET_CONFIG"
        sudo caddy validate --config "$TARGET_CONFIG"
        sudo systemctl reload caddy
    fi
    exit 1
fi

if ! sudo systemctl is-active --quiet caddy; then
    echo "[ERROR] Caddy is not active after reload; the previous configuration was not restored automatically." >&2
    exit 1
fi

echo "[OK] Caddy configuration installed and reloaded."

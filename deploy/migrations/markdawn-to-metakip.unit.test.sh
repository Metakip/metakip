#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migration_script="$SCRIPT_DIR/markdawn-to-metakip.sh"
# shellcheck source=markdawn-to-metakip.sh
. "$migration_script"

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT

env_file="$temp_dir/.env"
cat > "$env_file" <<'EOF'
FRONTEND_URL=https://app.markdawn.space
CORS_ORIGINS=https://app.markdawn.space
VITE_API_URL=https://app.markdawn.space
MCP_PUBLIC_URL=https://mcp.markdawn.space
VITE_APP_URL=https://app.markdawn.space
POSTGRES_USER=markdawn
POSTGRES_DB=markdawn
DATABASE_URL=postgresql://markdawn:secret@localhost:5432/markdawn
EOF

test "$(hostedEnvironmentState "$env_file")" = legacy
migrateHostedEnvironment "$env_file"
test "$(hostedEnvironmentState "$env_file")" = current
grep -qx 'POSTGRES_USER=markdawn' "$env_file"
grep -qx 'POSTGRES_DB=markdawn' "$env_file"
grep -qx 'DATABASE_URL=postgresql://markdawn:secret@localhost:5432/markdawn' "$env_file"
! grep -q '^VITE_APP_URL=' "$env_file"

legacy_stop=$(grep -n -m1 '^systemctl --user stop markdawn-api\.service' "$migration_script" | cut -d: -f1)
legacy_unit_removal=$(grep -n '"$QUADLET_DIR/markdawn\.pod"' "$migration_script" | cut -d: -f1)
normal_deploy=$(grep -n '^"$REPO_DIR/deploy/deploy\.sh"$' "$migration_script" | cut -d: -f1)
caddy_cutover=$(grep -n '^if \[ "$UPDATE_HOSTED_CADDY" = true \]; then$' "$migration_script" | cut -d: -f1)

test -n "$legacy_stop"
test -n "$legacy_unit_removal"
test -n "$normal_deploy"
test -n "$caddy_cutover"
test "$legacy_stop" -lt "$legacy_unit_removal"
test "$legacy_unit_removal" -lt "$normal_deploy"
test "$normal_deploy" -lt "$caddy_cutover"
! grep -Eq 'alter (role|database) markdawn' "$migration_script"

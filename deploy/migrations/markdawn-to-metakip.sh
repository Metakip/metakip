#!/bin/bash
set -Eeuo pipefail

OLD_REPO_DIR="/var/www/markdawn"
NEW_REPO_DIR="/var/www/metakip"
CADDY_CONFIG_PATH="${CADDY_CONFIG_PATH:-/etc/caddy/Caddyfile}"
QUADLET_DIR="$HOME/.config/containers/systemd"
MIGRATION_MARKER=".markdawn-to-metakip-migration"
MIGRATION_BASELINE="20260708053035_init"

fail() {
    echo "[ERROR] $*" >&2
    exit 1
}

postgresReady() {
    podman exec markdawn-postgres sh -c \
        'exec pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

postgresQuery() {
    local query="$1"

    podman exec markdawn-postgres sh -c \
        'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"' \
        postgres-query "$query"
}

hostedEnvironmentState() {
    local env_file="$1"
    local legacy_count=0
    local current_count=0
    local variable

    for variable in FRONTEND_URL CORS_ORIGINS VITE_API_URL; do
        grep -Eq "^${variable}=https://app\\.markdawn\\.space/?$" "$env_file" &&
            legacy_count=$((legacy_count + 1))
        grep -Eq "^${variable}=https://app\\.metakip\\.com/?$" "$env_file" &&
            current_count=$((current_count + 1))
    done
    grep -Eq '^MCP_PUBLIC_URL=https://mcp\.markdawn\.space/?$' "$env_file" &&
        legacy_count=$((legacy_count + 1))
    grep -Eq '^MCP_PUBLIC_URL=https://mcp\.metakip\.com/?$' "$env_file" &&
        current_count=$((current_count + 1))

    if [ "$legacy_count" -eq 4 ]; then
        echo legacy
    elif [ "$current_count" -eq 4 ]; then
        echo current
    elif [ "$legacy_count" -gt 0 ] || [ "$current_count" -gt 0 ]; then
        echo mixed
    else
        echo custom
    fi
}

migrateHostedEnvironment() {
    local env_file="$1"
    local temporary_file

    temporary_file=$(mktemp "${env_file}.migration.XXXXXX")
    if ! sed -E \
        -e 's|^(FRONTEND_URL|CORS_ORIGINS|VITE_API_URL)=https://app\.markdawn\.space/?$|\1=https://app.metakip.com|' \
        -e 's|^MCP_PUBLIC_URL=https://mcp\.markdawn\.space/?$|MCP_PUBLIC_URL=https://mcp.metakip.com|' \
        -e '/^VITE_APP_URL=/d' \
        "$env_file" > "$temporary_file"; then
        rm -f "$temporary_file"
        return 1
    fi
    chmod --reference="$env_file" "$temporary_file"
    mv -f "$temporary_file" "$env_file"
}

verifyMigrationCompatibility() {
    local has_application_tables
    local has_migration_table
    local has_migration_name_column
    local has_baseline

    echo "[CHECK] Verifying database migration compatibility..."
    has_application_tables=$(postgresQuery \
        "select (to_regclass('public.users') is not null)::text")
    if [ "$has_application_tables" != true ]; then
        return 0
    fi

    has_migration_table=$(postgresQuery \
        "select (to_regclass('drizzle.__drizzle_migrations') is not null)::text")
    has_migration_name_column=$(postgresQuery \
        "select exists (select 1 from information_schema.columns where table_schema = 'drizzle' and table_name = '__drizzle_migrations' and column_name = 'name')::text")
    if [ "$has_migration_table" != true ] || [ "$has_migration_name_column" != true ]; then
        fail "This database predates the current migration baseline. Follow the reset procedure at https://docs.metakip.com/self-hosting/maintain-a-self-hosted-metakip/."
    fi

    has_baseline=$(postgresQuery \
        "select exists (select 1 from drizzle.__drizzle_migrations where name = '$MIGRATION_BASELINE')::text")
    if [ "$has_baseline" != true ]; then
        fail "The database does not contain migration baseline $MIGRATION_BASELINE. Follow the reset procedure at https://docs.metakip.com/self-hosting/maintain-a-self-hosted-metakip/."
    fi
}

if [ "${BASH_SOURCE[0]}" != "$0" ]; then
    return 0
fi

if [ "$EUID" -eq 0 ]; then
    fail "Do not run this migration as root. Run it as the deploy user."
fi
if [ -e "$OLD_REPO_DIR" ] && [ -e "$NEW_REPO_DIR" ]; then
    fail "Both $OLD_REPO_DIR and $NEW_REPO_DIR exist. Refusing to choose an installation."
fi

if [ -d "$OLD_REPO_DIR/.git" ]; then
    REPO_DIR="$OLD_REPO_DIR"
    INITIAL_MIGRATION=true
elif [ -d "$NEW_REPO_DIR/.git" ] && [ -f "$NEW_REPO_DIR/$MIGRATION_MARKER" ]; then
    REPO_DIR="$NEW_REPO_DIR"
    INITIAL_MIGRATION=false
elif [ -d "$NEW_REPO_DIR/.git" ]; then
    echo "[OK] Metakip is already installed at $NEW_REPO_DIR."
    exit 0
else
    fail "Markdawn installation not found at $OLD_REPO_DIR."
fi

origin_url=$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)
if printf '%s\n' "$origin_url" | grep -Eiq 'github\.com[:/]atharva-again/markdawn(\.git)?/?$'; then
    git -C "$REPO_DIR" remote set-url origin https://github.com/Metakip/metakip.git
fi

echo "[CHECK] Updating the checkout before migration..."
git -C "$REPO_DIR" pull --ff-only origin master

ENV_FILE="$REPO_DIR/.env"
[ -f "$ENV_FILE" ] || fail "Environment file not found: $ENV_FILE"
[ -f "$REPO_DIR/deploy/Caddyfile" ] || fail "Metakip Caddyfile is missing from $REPO_DIR."
[ -f "$REPO_DIR/deploy/migrations/legacy-markdawn.Caddyfile" ] ||
    fail "Legacy Caddy reference is missing from $REPO_DIR."

environment_state=$(hostedEnvironmentState "$ENV_FILE")
if [ "$environment_state" = mixed ]; then
    fail "Hosted domain settings are only partially migrated. Review $ENV_FILE before continuing."
fi

UPDATE_HOSTED_CADDY=false
UPDATE_CUSTOM_CADDY=false
CUSTOM_CADDY_STAGE="$REPO_DIR/$MIGRATION_MARKER.Caddyfile"
if [ "$environment_state" = legacy ] || [ "$environment_state" = current ]; then
    if [ -f "$CADDY_CONFIG_PATH" ] && cmp -s \
        "$CADDY_CONFIG_PATH" "$REPO_DIR/deploy/migrations/legacy-markdawn.Caddyfile"; then
        echo "[CHECK] Validating the Metakip Caddy configuration..."
        sudo caddy validate --config "$REPO_DIR/deploy/Caddyfile"
        UPDATE_HOSTED_CADDY=true
    elif [ -f "$CADDY_CONFIG_PATH" ] &&
        cmp -s "$CADDY_CONFIG_PATH" "$REPO_DIR/deploy/Caddyfile"; then
        echo "[OK] Caddy already serves the Metakip hosted domains."
    else
        fail "The hosted Caddy configuration is customized or unrecognized. Review $CADDY_CONFIG_PATH before migrating."
    fi
elif [ -f "$CUSTOM_CADDY_STAGE" ]; then
    echo "[CHECK] Validating the staged custom Caddy configuration..."
    sudo caddy validate --config "$CUSTOM_CADDY_STAGE"
    UPDATE_CUSTOM_CADDY=true
elif [ -f "$CADDY_CONFIG_PATH" ] && grep -Fq "$OLD_REPO_DIR" "$CADDY_CONFIG_PATH"; then
    echo "[CHECK] Staging the custom Caddy configuration with the new installation path..."
    sed 's|/var/www/markdawn|/var/www/metakip|g' "$CADDY_CONFIG_PATH" > "$CUSTOM_CADDY_STAGE"
    chmod --reference="$CADDY_CONFIG_PATH" "$CUSTOM_CADDY_STAGE"
    sudo caddy validate --config "$CUSTOM_CADDY_STAGE"
    UPDATE_CUSTOM_CADDY=true
fi

if [ "$INITIAL_MIGRATION" = true ]; then
    echo "[CHECK] Starting the Markdawn database before moving the installation..."
    systemctl --user start markdawn-pod.service markdawn-postgres.service
    POSTGRES_READY=false
    for _ in {1..30}; do
        if postgresReady >/dev/null 2>&1; then
            POSTGRES_READY=true
            break
        fi
        sleep 2
    done
    [ "$POSTGRES_READY" = true ] || fail "PostgreSQL did not become ready before migration."
    verifyMigrationCompatibility
    touch "$REPO_DIR/$MIGRATION_MARKER"

    echo "[MIGRATION] Stopping Markdawn application services..."
    systemctl --user stop markdawn-api.service markdawn-mcp.service markdawn-collab.service 2>/dev/null || true

    echo "[MIGRATION] Moving $OLD_REPO_DIR to $NEW_REPO_DIR..."
    mv -- "$OLD_REPO_DIR" "$NEW_REPO_DIR"
    REPO_DIR="$NEW_REPO_DIR"
    ENV_FILE="$REPO_DIR/.env"
    CUSTOM_CADDY_STAGE="$REPO_DIR/$MIGRATION_MARKER.Caddyfile"
fi

if [ "$environment_state" = legacy ]; then
    echo "[MIGRATION] Updating hosted domain settings..."
    migrateHostedEnvironment "$ENV_FILE"
fi

OLD_POD_ID=""
if podman container exists markdawn-postgres; then
    OLD_POD_ID=$(podman inspect --format '{{.Pod}}' markdawn-postgres 2>/dev/null || true)
fi

echo "[MIGRATION] Retiring Markdawn services..."
systemctl --user stop markdawn-api.service markdawn-mcp.service markdawn-collab.service markdawn-postgres.service 2>/dev/null || true
systemctl --user stop markdawn-pod.service 2>/dev/null || true
if [ -n "$OLD_POD_ID" ] && podman pod exists "$OLD_POD_ID"; then
    podman pod rm --force "$OLD_POD_ID"
fi

if podman volume exists markdawn-data; then
    if podman volume exists metakip-data; then
        fail "Both markdawn-data and metakip-data exist. Refusing to choose an uploads volume."
    fi
    echo "[MIGRATION] Renaming the uploads volume..."
    podman volume rename markdawn-data metakip-data
fi

echo "[MIGRATION] Replacing installed service definitions..."
mkdir -p "$QUADLET_DIR"
cp "$REPO_DIR/deploy/quadlet/metakip.pod" "$QUADLET_DIR/"
cp "$REPO_DIR/deploy/quadlet/metakip-postgres.container" "$QUADLET_DIR/"
rm -f \
    "$QUADLET_DIR/markdawn.pod" \
    "$QUADLET_DIR/markdawn-postgres.container" \
    "$QUADLET_DIR/markdawn-api.container" \
    "$QUADLET_DIR/markdawn-mcp.container" \
    "$QUADLET_DIR/markdawn-collab.container" \
    "$QUADLET_DIR/markdawn-data.volume"
systemctl --user daemon-reload

if command -v semanage >/dev/null 2>&1 && command -v restorecon >/dev/null 2>&1; then
    echo "[MIGRATION] Updating the SELinux web-content path..."
    sudo semanage fcontext -d "$OLD_REPO_DIR/packages/web/dist(/.*)?" 2>/dev/null || true
    if ! sudo semanage fcontext -a -t httpd_sys_content_t \
        "$NEW_REPO_DIR/packages/web/dist(/.*)?" 2>/dev/null; then
        sudo semanage fcontext -m -t httpd_sys_content_t \
            "$NEW_REPO_DIR/packages/web/dist(/.*)?"
    fi
fi

echo "[MIGRATION] Running the normal Metakip deployment..."
"$REPO_DIR/deploy/deploy.sh"

if [ "$UPDATE_HOSTED_CADDY" = true ]; then
    echo "[MIGRATION] Switching Caddy to the Metakip hosted domains..."
    REPO_DIR="$REPO_DIR" CADDY_CONFIG_PATH="$CADDY_CONFIG_PATH" \
        "$REPO_DIR/deploy/update-caddy.sh"
elif [ "$UPDATE_CUSTOM_CADDY" = true ]; then
    echo "[MIGRATION] Updating the custom Caddy installation path..."
    REPO_DIR="$REPO_DIR" CADDY_CONFIG_PATH="$CADDY_CONFIG_PATH" \
        CADDY_SOURCE_CONFIG="$CUSTOM_CADDY_STAGE" "$REPO_DIR/deploy/update-caddy.sh"
    rm -f "$CUSTOM_CADDY_STAGE"
fi

rm -f "$REPO_DIR/$MIGRATION_MARKER"
echo "[DONE] Markdawn has been migrated to Metakip."

#!/bin/bash
set -e

REPO_DIR="/var/www/metakip"

echo "Metakip Deployment"
echo "==================="

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -d /var/www/markdawn/.git ]; then
    echo -e "${RED}[ERROR] A legacy Markdawn deployment was detected.${NC}"
    echo "Follow the one-time migration at https://docs.metakip.com/self-hosting/maintain-a-self-hosted-metakip/." >&2
    exit 1
fi

cd "$REPO_DIR"

MIGRATION_BASELINE="20260708053035_init"
POSTGRES_CONTAINER="metakip-postgres"
POSTGRES_SERVICE="metakip-postgres.service"

postgresReady() {
    podman exec "$POSTGRES_CONTAINER" sh -c \
        'exec pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

postgresQuery() {
    local query="$1"

    podman exec "$POSTGRES_CONTAINER" sh -c \
        'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"' \
        postgres-query "$query"
}

if podman volume exists postgres-data; then
    POSTGRES_RUNNING=false
    if podman container exists "$POSTGRES_CONTAINER"; then
        POSTGRES_RUNNING=$(podman inspect --format '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || echo false)
    fi
    if [ "$POSTGRES_RUNNING" != "true" ]; then
        echo -e "${YELLOW}[CHECK] Starting PostgreSQL from the existing volume for compatibility checks...${NC}"
        if ! systemctl --user start "$POSTGRES_SERVICE"; then
            echo -e "${RED}[ERROR] PostgreSQL could not be started; refusing to modify deployment artifacts.${NC}"
            exit 1
        fi
    fi
fi

if podman container exists "$POSTGRES_CONTAINER"; then
    echo -e "${YELLOW}[CHECK] Verifying database migration compatibility...${NC}"
    POSTGRES_READY=false
    for _ in {1..30}; do
        if postgresReady >/dev/null 2>&1; then
            POSTGRES_READY=true
            break
        fi
        sleep 2
    done
    if [ "$POSTGRES_READY" != "true" ]; then
        echo -e "${RED}[ERROR] PostgreSQL is unavailable; refusing to modify deployment artifacts.${NC}"
        exit 1
    fi

    HAS_APPLICATION_TABLES=$(postgresQuery "select (to_regclass('public.users') is not null)::text")
    if [ "$HAS_APPLICATION_TABLES" = "true" ]; then
        HAS_MIGRATION_TABLE=$(postgresQuery \
            "select (to_regclass('drizzle.__drizzle_migrations') is not null)::text")
        HAS_MIGRATION_NAME_COLUMN=$(postgresQuery \
            "select exists (select 1 from information_schema.columns where table_schema = 'drizzle' and table_name = '__drizzle_migrations' and column_name = 'name')::text")
        if [ "$HAS_MIGRATION_TABLE" != "true" ] || [ "$HAS_MIGRATION_NAME_COLUMN" != "true" ]; then
            echo -e "${RED}[ERROR] This database predates the current migration baseline.${NC}"
            echo "This release requires a clean database. Follow the reset procedure at https://docs.metakip.com/self-hosting/maintain-a-self-hosted-metakip/."
            exit 1
        fi

        HAS_BASELINE=$(postgresQuery \
            "select exists (select 1 from drizzle.__drizzle_migrations where name = '$MIGRATION_BASELINE')::text")
        if [ "$HAS_BASELINE" != "true" ]; then
            echo -e "${RED}[ERROR] This database does not contain migration baseline $MIGRATION_BASELINE.${NC}"
            echo "This release requires a clean database. Follow the reset procedure at https://docs.metakip.com/self-hosting/maintain-a-self-hosted-metakip/."
            exit 1
        fi
    fi
fi

# Validate compatibility before pulling code, replacing Quadlet units, or overwriting image tags.
echo -e "${YELLOW}[STEP 1/9] Pulling latest code...${NC}"
git pull origin master

# shellcheck source=collaboration-secret.sh
. "$REPO_DIR/deploy/collaboration-secret.sh"
# shellcheck source=migrate-editor-content.sh
. "$REPO_DIR/deploy/migrate-editor-content.sh"
# shellcheck source=mcp-api-secret.sh
. "$REPO_DIR/deploy/mcp-api-secret.sh"
# shellcheck source=mcp-public-url.sh
. "$REPO_DIR/deploy/mcp-public-url.sh"
# shellcheck source=upload-storage.sh
. "$REPO_DIR/deploy/upload-storage.sh"

# Existing installations predate the private API-to-collaboration command
# boundary. Generate its independent credential once during upgrade, and
# refuse repository placeholders rather than starting with a known secret.
ensureCollaborationSecret .env
ensureMcpApiInternalSecret .env
migrateUploadStorage .env
ensureUploadStorage .env

echo -e "${YELLOW}[STEP 2/9] Installing dependencies...${NC}"
pnpm install
ensureMcpPublicUrl .env

echo -e "${YELLOW}[STEP 3/9] Building web packages...${NC}"
pnpm --filter @metakip/shared build
rm -rf "$REPO_DIR/packages/web/dist.next"
pnpm --filter @metakip/web exec tsc --project tsconfig.build.json
pnpm --filter @metakip/web exec vite build --outDir dist.next

echo -e "${YELLOW}[STEP 4/9] Updating Podman Quadlet units...${NC}"
podman volume create postgres-data 2>/dev/null || true
podman volume create metakip-data 2>/dev/null || true
cp "$REPO_DIR/deploy/quadlet/metakip.pod" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-postgres.container" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-api.container" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-mcp.container" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-collab.container" ~/.config/containers/systemd/
systemctl --user daemon-reload

echo -e "${YELLOW}[STEP 5/9] Rebuilding container images...${NC}"
podman build -t localhost/metakip-api:latest -f "$REPO_DIR/deploy/Containerfile.api" "$REPO_DIR"
podman build -t localhost/metakip-mcp:latest -f "$REPO_DIR/deploy/Containerfile.mcp" "$REPO_DIR"
podman build -t localhost/metakip-collab:latest -f "$REPO_DIR/deploy/Containerfile.collab" "$REPO_DIR"

echo -e "${YELLOW}[STEP 6/9] Recreating the application pod...${NC}"
# Podman fixes published ports when a pod is created. Capture the current pod
# before stopping its Quadlet services so changes such as localhost-only port
# bindings cannot leave an older, publicly bound pod running.
EXISTING_POD_ID=""
if podman container exists "$POSTGRES_CONTAINER"; then
    EXISTING_POD_ID=$(podman inspect --format '{{.Pod}}' "$POSTGRES_CONTAINER")
fi
systemctl --user stop metakip-api.service metakip-mcp.service metakip-collab.service metakip-postgres.service 2>/dev/null || true
systemctl --user stop metakip-pod.service 2>/dev/null || true
if [ -n "$EXISTING_POD_ID" ] && podman pod exists "$EXISTING_POD_ID"; then
    podman pod rm --force "$EXISTING_POD_ID"
fi

echo -e "${YELLOW}[STEP 7/9] Starting PostgreSQL in the recreated pod...${NC}"
systemctl --user start metakip-pod.service metakip-postgres.service
POSTGRES_READY=false
for _ in {1..30}; do
    if postgresReady >/dev/null 2>&1; then
        POSTGRES_READY=true
        break
    fi
    sleep 2
done
if [ "$POSTGRES_READY" != "true" ]; then
    echo -e "${RED}[ERROR] PostgreSQL is unavailable after recreating the pod.${NC}"
    exit 1
fi

echo -e "${YELLOW}[STEP 8/9] Running database migrations...${NC}"
pnpm --filter @metakip/api db:migrate
migrateEditorContent "$REPO_DIR"

# Keep the old editor bundle live until every page has been converted. This
# prevents old XML clients and the new Markdown client from overlapping during
# the one-way editor migration.
rm -rf "$REPO_DIR/packages/web/dist.previous"
if [ -d "$REPO_DIR/packages/web/dist" ]; then
    mv "$REPO_DIR/packages/web/dist" "$REPO_DIR/packages/web/dist.previous"
fi
mv "$REPO_DIR/packages/web/dist.next" "$REPO_DIR/packages/web/dist"
if command -v restorecon &>/dev/null; then
    sudo restorecon -R "$REPO_DIR/packages/web/dist"
fi
rm -rf "$REPO_DIR/packages/web/dist.previous"

echo -e "${YELLOW}[STEP 9/9] Starting application services...${NC}"
systemctl --user start metakip-api.service metakip-mcp.service metakip-collab.service

echo -e "${YELLOW}[CHECK] Verifying API is healthy...${NC}"
for i in {1..15}; do
    if curl -sf --max-time 5 "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] API is healthy.${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}[ERROR] API health check failed after restart.${NC}"
        exit 1
    fi
    sleep 2
done

echo -e "${YELLOW}[CHECK] Verifying MCP service is healthy...${NC}"
for i in {1..15}; do
    if curl -sf --max-time 5 "http://127.0.0.1:3002/api/ready" >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] MCP service is healthy.${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}[ERROR] MCP service health check failed after restart.${NC}"
        exit 1
    fi
    sleep 2
done

echo -e "${YELLOW}[CHECK] Verifying collaboration service is healthy...${NC}"
for i in {1..15}; do
    if curl -sf --max-time 5 "http://127.0.0.1:1234/health" >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] Collaboration service is healthy.${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}[ERROR] Collaboration service health check failed after restart.${NC}"
        exit 1
    fi
    sleep 2
done

DEPLOYED_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') deploy: $DEPLOYED_COMMIT" >> "$REPO_DIR/.deploy-log"

echo -e "${GREEN}[DONE] Deployment complete!${NC}"
echo ""
echo "Deployed commit: $DEPLOYED_COMMIT"
echo "Check status: systemctl --user status metakip-postgres.service metakip-api.service metakip-mcp.service metakip-collab.service"
echo "View logs:    journalctl --user -u metakip-api.service -f"
echo "MCP logs:     journalctl --user -u metakip-mcp.service -f"
echo "API health:   curl https://app.metakip.com/api/health"

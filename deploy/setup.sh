#!/bin/bash
set -e

echo "Metakip Podman Setup"
echo "====================="

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}[ERROR] Do not run as root. Run as the deploy user.${NC}"
    exit 1
fi

if [ -d /var/www/markdawn/.git ]; then
    echo -e "${RED}[ERROR] A legacy Markdawn deployment was detected.${NC}"
    echo "Follow the one-time migration at https://docs.metakip.com/self-hosting/maintain-a-self-hosted-metakip/." >&2
    exit 1
fi

echo -e "${YELLOW}[STEP 1/8] Installing common tools, Podman, and Caddy...${NC}"
sudo dnf install -y git nano curl openssl podman dnf5-plugins unzip
sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy
sudo dnf install -y firewalld
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

echo -e "${YELLOW}[STEP 2/8] Enabling lingering for user systemd services...${NC}"
sudo loginctl enable-linger "$(whoami)"

echo -e "${YELLOW}[STEP 3/8] Preparing repository...${NC}"
sudo mkdir -p /var/www
sudo chown -R "$(whoami):$(whoami)" /var/www

if [ -d ".git" ]; then
    echo -e "${GREEN}[OK] Running from existing repo. Using current directory.${NC}"
    REPO_DIR="$(pwd)"
else
    echo -e "${YELLOW}Cloning repository...${NC}"
    git clone https://github.com/Metakip/metakip.git /var/www/metakip
    REPO_DIR="/var/www/metakip"
fi

cd "$REPO_DIR"

# shellcheck source=collaboration-secret.sh
. "$REPO_DIR/deploy/collaboration-secret.sh"
# shellcheck source=migrate-editor-content.sh
. "$REPO_DIR/deploy/migrate-editor-content.sh"
# shellcheck source=mcp-api-secret.sh
. "$REPO_DIR/deploy/mcp-api-secret.sh"
# shellcheck source=mcp-public-url.sh
. "$REPO_DIR/deploy/mcp-public-url.sh"

echo -e "${YELLOW}[STEP 4/8] Installing Node.js and pnpm...${NC}"
curl -fsSL https://fnm.vercel.app/install | bash
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --shell bash)"
fnm install 24
fnm use 24
node -v
corepack enable pnpm
pnpm -v

echo -e "${YELLOW}[STEP 5/8] Configuring environment...${NC}"
created_env=false
if [ -f ".env" ]; then
    echo -e "${GREEN}[OK] .env already exists. Skipping creation.${NC}"
else
    cp .env.production .env
    created_env=true
fi
ensureCollaborationSecret .env
ensureMcpApiInternalSecret .env
if [ "$created_env" = "true" ]; then
    echo -e "${YELLOW}.env created from .env.production. Edit it now:${NC}"
    nano .env
fi

echo -e "${YELLOW}[STEP 6/8] Building application...${NC}"
pnpm install
ensureMcpPublicUrl .env
pnpm --filter @metakip/shared build
pnpm --filter @metakip/web build

echo -e "${YELLOW}[STEP 7/8] Setting up Podman Quadlet services...${NC}"
mkdir -p ~/.config/containers/systemd

echo -e "${YELLOW}[PULL] Pre-pulling PostgreSQL image to avoid timeout on first start...${NC}"
podman pull docker.io/library/postgres:17-alpine

podman volume create postgres-data 2>/dev/null || true
podman volume create metakip-data 2>/dev/null || true

cp "$REPO_DIR/deploy/quadlet/metakip.pod" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-postgres.container" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-api.container" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-mcp.container" ~/.config/containers/systemd/
cp "$REPO_DIR/deploy/quadlet/metakip-collab.container" ~/.config/containers/systemd/

podman build -t localhost/metakip-api:latest -f "$REPO_DIR/deploy/Containerfile.api" "$REPO_DIR"
podman build -t localhost/metakip-mcp:latest -f "$REPO_DIR/deploy/Containerfile.mcp" "$REPO_DIR"
podman build -t localhost/metakip-collab:latest -f "$REPO_DIR/deploy/Containerfile.collab" "$REPO_DIR"

echo -e "${YELLOW}[STEP 8/8] Configuring Caddy reverse proxy...${NC}"
sudo caddy validate --config "$REPO_DIR/deploy/Caddyfile"
sudo cp "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile

if command -v semanage &>/dev/null && command -v restorecon &>/dev/null; then
    echo -e "${YELLOW}[SELinux] Setting httpd_sys_content_t on web dist...${NC}"
    sudo semanage fcontext -a -t httpd_sys_content_t "$REPO_DIR/packages/web/dist(/.*)?" 2>/dev/null || true
    sudo restorecon -R "$REPO_DIR/packages/web/dist"
fi

sudo systemctl enable --now caddy
sudo systemctl reload caddy

systemctl --user daemon-reload
systemctl --user start metakip-pod.service
systemctl --user start metakip-postgres.service

echo -e "${YELLOW}[WAIT] Waiting for PostgreSQL to be ready...${NC}"
for i in {1..30}; do
    if podman exec metakip-postgres sh -c \
        'exec pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] PostgreSQL is ready.${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}[ERROR] PostgreSQL did not become ready in time.${NC}"
        exit 1
    fi
    sleep 2
done

echo -e "${YELLOW}[SCHEMA] Running db:migrate to initialize database...${NC}"
pnpm --filter @metakip/api db:migrate
migrateEditorContent "$REPO_DIR"

systemctl --user start metakip-api.service metakip-mcp.service metakip-collab.service

echo -e "${YELLOW}[CHECK] Verifying MCP service and API connectivity...${NC}"
for i in {1..15}; do
    if curl -sf --max-time 5 "http://127.0.0.1:3002/api/ready" >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] MCP service is ready.${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}[ERROR] MCP service readiness check failed after setup.${NC}"
        exit 1
    fi
    sleep 2
done

echo -e "${GREEN}[DONE] Setup complete!${NC}"
echo ""
echo "Check status: systemctl --user status metakip-postgres.service metakip-api.service metakip-mcp.service metakip-collab.service"
echo "View logs:    journalctl --user -u metakip-api.service -f"
echo "MCP logs:     journalctl --user -u metakip-mcp.service -f"
echo "API health:   curl https://app.metakip.com/api/health"

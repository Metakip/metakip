---
title: Move A Self-Hosted Metakip Deployment
description: Move a self-hosted Metakip installation, PostgreSQL data, upload storage, environment values, and DNS to another compatible server.
---

Use this runbook to move a compatible Metakip installation from one Linux server to another.

The goal is a new server with the same application services and persistent data. Keep the old server stopped until you have verified the new deployment.

The documented commands assume Fedora, rootless Podman, external DNS, and administrative access on both servers. If the source or destination uses Ubuntu, Docker Compose, or another container runtime, adapt the service and volume commands while preserving the same application services and persistent data.

## Prepare The New Server

Clone the repository and copy the existing environment file:

```bash
sudo dnf install -y git
sudo mkdir -p /var/www
sudo chown "$USER:$USER" /var/www
git clone https://github.com/Metakip/metakip.git /var/www/metakip
scp old-server:/var/www/metakip/.env /var/www/metakip/.env
cd /var/www/metakip
./deploy/setup.sh
```

Verify the new deployment, then stop its application services before restoring data.

## Capture The Old Data

Stop writes before taking final snapshots:

```bash
systemctl --user stop metakip-api.service metakip-collab.service
podman exec metakip-postgres pg_dump -U metakip -d metakip \
  --format=custom --no-owner > /tmp/metakip-db.dump
podman volume export metakip-data > /tmp/metakip-data.tar
```

Copy both snapshots to the new server.

The copied environment file preserves the selected upload backend. When using R2, it keeps the
deployment connected to the same private bucket. The `metakip-data` snapshot is required for local
uploads and should be retained as a rollback backup after an explicit R2 migration.

## Restore The Data

```bash
cat /tmp/metakip-db.dump | podman exec -i metakip-postgres \
  pg_restore -U metakip -d metakip --clean --if-exists --no-owner
podman volume import metakip-data /tmp/metakip-data.tar
```

Apply migrations and restart the services:

```bash
cd /var/www/metakip
pnpm --filter @metakip/api db:migrate
systemctl --user start metakip-api.service metakip-collab.service
curl http://localhost:3001/api/health
```

## Cut Over DNS

1. Point the domain's DNS records to the new server.
2. Restart Caddy.
3. Check the public API and collaborative editing.
4. Keep the old server stopped until the new server is confirmed healthy.

Keep the old server and both snapshots available until you have verified pages, uploads, login, sharing, and editing.

For routine updates instead of a server move, use [Maintain a Self-Hosted Metakip](/self-hosting/maintain-a-self-hosted-metakip/).

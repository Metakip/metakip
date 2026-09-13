---
title: Maintain A Self-Hosted Metakip
description: Check Metakip services, update a self-hosted installation, protect migration history, and recover from common deployment failures.
---

Use this guide after the first deployment to check services, update the application, and recover from common failures.

Keep a recent database backup and an accessible copy of your environment file before updates. Do not put the environment file or API tokens in a repository.

## Check Service Status

```bash
systemctl --user status metakip-postgres.service metakip-api.service metakip-collab.service
```

## Read Logs

```bash
journalctl --user -u metakip-api.service -f
journalctl --user -u metakip-collab.service -f
journalctl --user -u metakip-postgres.service -f
```

## Update The Application

If this server still runs Markdawn from `/var/www/markdawn`, run the one-time product migration before using the normal Metakip update command:

```bash
curl -fsSL https://raw.githubusercontent.com/Metakip/metakip/master/deploy/migrations/markdawn-to-metakip.sh \
  -o /tmp/markdawn-to-metakip.sh
bash /tmp/markdawn-to-metakip.sh
rm /tmp/markdawn-to-metakip.sh
```

The migration validates the database and replacement Caddy configuration before stopping services or changing live settings. It then moves the checkout to `/var/www/metakip`, updates the hosted domain settings, replaces the installed service definitions, preserves the existing PostgreSQL role and database names, runs the normal deployment, and switches Caddy after the replacement services are healthy. The script can be rerun if the normal deployment fails after the directory move.

For a custom-domain deployment, the migration preserves the installed Caddy configuration and changes only references from `/var/www/markdawn` to `/var/www/metakip`. It validates the staged result before moving the installation. A customized configuration paired with the official hosted domains is not changed automatically; the migration stops before changing live settings so the hosted-domain cutover can be reviewed manually.

After the first deployment, fetch and run the deployment script from the target revision:

```bash
cd /var/www/metakip
git fetch origin master
git show origin/master:deploy/deploy.sh > /tmp/metakip-deploy.sh
bash /tmp/metakip-deploy.sh
rm /tmp/metakip-deploy.sh
```

The update script pulls code, installs dependencies, builds packages, updates Podman units, preserves the existing uploads volume, applies pending schema migrations, restarts services, and checks API health. It operates only on an already-current Metakip installation; the one-time Markdawn migration is kept separate.

An upgraded installation may continue to use `markdawn` as its internal PostgreSQL role and database name. Fresh installations use `metakip`. The application reads those values from `.env`, and the names do not affect the product or its public URLs.

The current Drizzle v1 baseline is not compatible with databases created from the removed legacy migration history. `deploy.sh` checks this before pulling code or replacing deployment artifacts and exits without resetting an incompatible database.

### Reset An Incompatible Database

This permanently deletes the existing PostgreSQL data. Run it only when a clean reset is intended:

```bash
cd /var/www/metakip
systemctl --user stop metakip-api.service metakip-collab.service metakip-postgres.service metakip-pod.service
podman volume rm postgres-data
./deploy/setup.sh
```

`setup.sh` creates a fresh `postgres-data` volume and applies the current migrations. Running `setup.sh` without removing the incompatible volume does not reset the database.

## Check The Public API

```bash
curl https://your-domain.example/api/health
```

## Common Problems

### Caddy Cannot Get A Certificate

Confirm that the domain resolves to the VPS and ports 80 and 443 are open.

### Containers Do Not Start

Check service logs and confirm that `/var/www/metakip/.env` exists.

### Database Connection Errors

Confirm that `DATABASE_URL` points to `localhost:5432` and does not include `sslmode=require`.

```bash
systemctl --user status metakip-postgres.service
podman exec metakip-postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### OAuth Login Fails

Compare the callback URL in the provider dashboard with the URL configured in Metakip. The protocol, domain, path, and trailing slash must match.

### The Browser Shows A Blank Page

Confirm that `VITE_API_URL` was set before building the web package. Caddy must proxy the same-origin `/collab` WebSocket route to the collaboration service.

## Migration Safety

Do not use `db:push` on a migrated database. Use the checked-in schema migrations and run `db:migrate` through the deployment workflow.

For a server move, follow [Move a Metakip Deployment](/self-hosting/move-a-metakip-deployment/). For a first installation, return to [Deploy Metakip on a Fedora VPS](/self-hosting/deploy-metakip-on-a-vps/).

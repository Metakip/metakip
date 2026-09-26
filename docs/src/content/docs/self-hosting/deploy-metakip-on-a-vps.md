---
title: Deploy Metakip On A Fedora VPS
description: Deploy Metakip on a Fedora VPS with Caddy, rootless Podman, PostgreSQL, OAuth, persistent storage, and database migrations.
---

This guide documents the maintained deployment path for one Fedora VPS with Caddy, rootless Podman, and PostgreSQL.

Follow this guide when you want a documented first installation. It assumes you can manage DNS, open firewall ports, edit environment values, and use `sudo` on the server.

## Prerequisites

Prepare:

- A Fedora 44 VPS with at least 4 GB of RAM.
- A domain or subdomain pointing to the VPS IP address.
- A deployment user with `sudo` access.
- Google and GitHub OAuth applications if you want social login.

Open ports 80 and 443 so Caddy can receive web traffic and obtain a certificate.

## Other Linux Distributions And Docker Compose

The setup script targets Fedora and Podman. It is not a requirement imposed by the application.

An adapted deployment needs to provide:

- PostgreSQL with persistent storage.
- The Metakip API.
- The collaboration service with WebSocket support.
- The MCP gateway when offering remote MCP access.
- The built web application.
- A reverse proxy for the public origin, API routes, `/collab` WebSocket traffic,
  and the MCP gateway's `/mcp` and OAuth routes when MCP is enabled.
- The environment variables from `.env.production`.
- Persistent storage for the database and either local upload storage or a private Cloudflare R2 bucket.
- `db:migrate` before the application accepts traffic.

The included scripts do not manage every alternative environment. If you use Docker Compose or Ubuntu, adapt the service definitions and maintain the deployment yourself.

## Run The Setup Script

Run these commands on the documented Fedora server as a non-root user:

```bash
curl -fsSL https://raw.githubusercontent.com/Metakip/metakip/master/deploy/setup.sh -o setup.sh
chmod +x setup.sh
./setup.sh
```

The script prompts you to edit `.env`, installs required tools, creates persistent storage, builds the services, applies database migrations, and starts the application.

### Custom domains

The checked-in Caddy configuration serves the application at `app.metakip.com`. The public marketing site is hosted separately. The setup script copies the Caddy file to `/etc/caddy/Caddyfile`; setting `FRONTEND_URL` does not change the Caddy hostname automatically. Custom domains therefore require a manual Caddyfile edit.

For a root-based custom deployment, remove the `metakip.com` site block and rename the `app.metakip.com` site block to your domain in `deploy/Caddyfile` before running the setup script when using an existing checkout, or make the same edit after setup. The app site block includes compatibility redirects from legacy `/app/...` paths to root-based paths. The setup script also starts MCP, so rename the `mcp.metakip.com` site block to the MCP hostname you control; it must reverse proxy to `localhost:3002`. If you intentionally do not expose MCP, remove its service and Caddy site block from your adapted deployment.

```sh
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Replace the site addresses with the domain that points to the VPS. For a root-based self-hosted deployment, use that domain in `FRONTEND_URL`, `CORS_ORIGINS`, `VITE_API_URL`, and the OAuth redirect URLs below. Caddy must be able to resolve the domain and reach ports 80 and 443 to obtain its certificate.

## Configure Environment Values

At minimum, review:

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
DATABASE_URL
BETTER_AUTH_SECRET
FRONTEND_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
CORS_ORIGINS
NODE_ENV
PORT
COLLAB_PORT
VITE_API_URL
MCP_PUBLIC_URL
MCP_API_URL
MCP_API_INTERNAL_SECRET
UPLOAD_STORAGE
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

Set `UPLOAD_STORAGE` to `local` or `r2`. Local storage uses the persistent Metakip data volume.
For R2, create a private bucket and an API token with object read, write, and delete access to that
bucket, then configure all four `R2_*` values. Metakip stores stable application URLs in page
Markdown and authorizes every download, so the bucket must not be public.

Do not switch an existing installation directly from local storage to R2. Stop the API, keep
`UPLOAD_STORAGE=local`, configure the four `R2_*` values, and run:

```sh
UPLOAD_MIGRATION_SOURCE_DIR="$(podman volume inspect metakip-data --format '{{.Mountpoint}}')" \
  pnpm --filter @metakip/api uploads:migrate-to-r2
```

Run the command as the same user that owns the rootless Podman deployment. The explicit source
directory points the host-side migration at the `metakip-data` volume mounted by the API container;
the migration refuses to guess this path. The command copies and verifies every database-tracked
upload and is safe to rerun. Switch `UPLOAD_STORAGE=r2` only after it succeeds, then restart the API.
Retain the local upload volume for a rollback period. Normal R2 reads do not perform migration.

When upgrading an installation created before upload backends were configurable, the deployment
script adds `UPLOAD_STORAGE=local` so the existing persistent upload volume continues to be used.
Moving that installation to R2 remains an explicit configuration change.

Use a secret of at least 32 characters for `BETTER_AUTH_SECRET`. Create a unique `COLLAB_INTERNAL_SECRET` of at least 32 characters. The setup and deployment scripts generate `MCP_API_INTERNAL_SECRET`; never use the development value in production. Do not reuse example passwords or commit `.env`.

The normal setup and deployment scripts only manage Metakip installations. Existing Markdawn servers must first run the one-time migration documented in [Maintain a Self-Hosted Metakip](/self-hosting/maintain-a-self-hosted-metakip/). That migration preserves the existing PostgreSQL role and database names while moving the installation, service definitions, hosted domains, and uploads volume to their Metakip locations. Better Auth derives its issuer as `${FRONTEND_URL}/api/auth` unless `BETTER_AUTH_ISSUER` is explicitly set; if you set that override, it must match the public frontend domain.

For the hosted deployment, `MCP_PUBLIC_URL` is `https://mcp.metakip.com`. For a self-hosted MCP hostname, set it to the complete public HTTPS origin, such as `https://mcp.your-domain.example`. It must be an origin only: do not include a path, query, fragment, credentials, or a non-HTTPS scheme. The deployment validator accepts custom public HTTPS hostnames and rejects loopback or IP-literal production origins. `MCP_API_URL` may use HTTP only for a loopback API on the same machine; remote API origins must use HTTPS because the MCP-to-API credential crosses that connection.

To apply the checked-in Caddy changes explicitly, review and run:

```sh
sudo /var/www/metakip/deploy/update-caddy.sh
```

This command validates the repository configuration, backs up the installed configuration, installs the new file, reloads Caddy, and verifies that the service remains active. It intentionally replaces `/etc/caddy/Caddyfile`; merge custom domains and rules into `deploy/Caddyfile` first.

## Configure OAuth Redirects

Register these redirect URLs for your domain:

```text
https://your-domain.example/api/auth/callback/google
https://your-domain.example/api/auth/callback/github
```

The URLs must match the provider configuration exactly.

## Verify The Deployment

```bash
curl https://your-domain.example/api/health
```

A healthy service returns a JSON response with `status` set to `ok`. Then open the domain and sign in.

After signing in, verify one page can be created and edited in the browser. If you use collaborative editing, open a second browser session and confirm that changes appear in both sessions.

## If Setup Fails

```bash
journalctl --user -u metakip-postgres.service --no-pager
journalctl --user -u metakip-api.service --no-pager
journalctl --user -u metakip-mcp.service --no-pager
journalctl --user -u metakip-collab.service --no-pager
```

For later updates and migration safety, see [Maintain a Self-Hosted Metakip](/self-hosting/maintain-a-self-hosted-metakip/). To move the installation, see [Move a Metakip Deployment](/self-hosting/move-a-metakip-deployment/).

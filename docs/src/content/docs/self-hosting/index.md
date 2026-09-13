---
title: Self-Host Metakip
description: Run Metakip on infrastructure you control with the maintained Fedora, Caddy, rootless Podman, and PostgreSQL deployment path.
---

Self-hosting runs Metakip on infrastructure you control instead of using the hosted service. The maintained path uses one Fedora VPS, Caddy, rootless Podman containers, and PostgreSQL.

The documented deployment path uses one Fedora VPS with Caddy, rootless Podman containers, and self-hosted PostgreSQL. This is the path covered by the included setup and deployment scripts.

Metakip is made up of containerized application services, so an experienced operator can adapt the deployment to Ubuntu, another Linux distribution, Docker Compose, or another compatible container environment. Those deployments require manual adaptation and verification rather than using the Fedora setup script unchanged.

## Choose Your Guide

- [Deploy Metakip on a VPS](/self-hosting/deploy-metakip-on-a-vps/) covers the documented first installation.
- [Maintain a Self-Hosted Metakip](/self-hosting/maintain-a-self-hosted-metakip/) covers updates, service checks, logs, and common failures.
- [Move a Metakip Deployment](/self-hosting/move-a-metakip-deployment/) covers moving a compatible installation to another server.

## What You Run

- Caddy or another public reverse proxy.
- PostgreSQL 17 with persistent storage.
- The Metakip API service.
- The Metakip collaboration service.
- The built web application.
- Persistent storage for the database and uploads.

The API and collaboration services must be reachable through the public web origin. PostgreSQL should remain private to the application services.

## Important Data Rule

Use the checked-in database migrations. Do not use `db:push` on a database that has migration history.

## Deployment Choices

Use the documented Fedora and Podman path when you want the shortest route from a clean server to a working installation.

Use Ubuntu, Docker Compose, or another container runtime when you are comfortable translating the service definitions and maintaining the result yourself. Keep the same application boundaries, environment variables, persistent volumes, database migrations, health checks, OAuth callback paths, and collaboration WebSocket routing.

## Before You Choose This Path

Self-hosting means you are responsible for DNS, TLS, backups, updates, database migrations, secrets, storage, and service health. Use the maintained Fedora path when you want the documented setup. Adapt the deployment only when you are prepared to verify the equivalent services yourself.

## Next Steps

Start with [Deploy Metakip on a VPS](/self-hosting/deploy-metakip-on-a-vps/), then keep [Maintain a Self-Hosted Metakip](/self-hosting/maintain-a-self-hosted-metakip/) available for updates and recovery.

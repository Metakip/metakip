# Metakip

<p align="center">
  <img width="856" height="496" alt="image" src="https://github.com/user-attachments/assets/52d73f74-0f77-498d-a92a-cd6b039a0e3d" />
</p>

Metakip is a knowledge base for humans and their AI agents.

Try it out at [metakip.com](https://metakip.com) — currently in public beta.

Notion is a human tool with an API bolted on. Obsidian is a local vault you sync. Metakip is built different. The same product works headful in a browser and headless via REST API. Write a page in your browser. Have an agent read, edit, and link to it via the same endpoints. No wrappers, no adapters, no dual-mode. Bring your own agents and workflows instead of relearning everything!

---

## CLI

Install Metakip for your terminal and agents:

```sh
curl -fsSL https://metakip.com/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://metakip.com/install.ps1 | iex
```

Coding agents should follow the dedicated [Metakip skill](skills/metakip/SKILL.md). See the
[CLI guide](cli/README.md) for CLI installation and command reference details.

---

## The Product Thesis

Most "AI + docs" tools are a human app with an agent API wrapper. Metakip inverts this: the content layer works identically headful and headless. Agents aren't "supported" — they're first-class users. A page created by an agent looks exactly like a page created by a human. A wiki link from a human to an agent-created page works the same as any other link.

This means:
- No "agent mode" toggle
- No separate data stores for human vs. agent content
- No sync layer between "your notes" and "agent memory"
- The graph is unified. The API is the product.

---

## Self-Hosted

Open source under GNU AGPL v3. Run it on your own infrastructure.

- [Deployment Guide](https://docs.metakip.com/self-hosting/deploy-metakip-on-a-vps/) — step-by-step for a single VPS with Caddy, Podman, and PostgreSQL
- [deploy/](deploy/) — `setup.sh` (one-time server bootstrap) and `deploy.sh` (incremental deploy)

## Local Development

```bash
cp .env.dev .env
pnpm dev
```

Use `http://localhost:5173` for the application. This keeps local OAuth
callbacks compatible with providers such as Google. In a second terminal, run:

```bash
pnpm dev:marketing-site
```

Then use `http://localhost:8888` for the landing page. Its Web link points to
the application root at `http://localhost:5173`.

Both the API and collaboration service require `COLLAB_INTERNAL_SECRET`. The development
template provides a localhost-only value so a fresh checkout starts immediately. For every
non-development environment, generate and set a unique secret with `openssl rand -hex 32`.

Remote MCP access is available at `https://mcp.metakip.com/mcp`. Local development
can run it at `http://localhost:3002`.

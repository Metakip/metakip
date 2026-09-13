---
title: Use Metakip With MCP
description: Connect an AI assistant to Metakip through remote MCP and OAuth.
---

Metakip supports remote MCP connections for AI assistants that support the
protocol. A connected assistant can work with the same pages and folders you
use in the browser, CLI, and API.

## Connect To Metakip

Use this MCP endpoint in your assistant:

```text
https://mcp.metakip.com/mcp
```

On the first connection, Metakip asks you to sign in and approve the access
the assistant requested. Review the permissions before approving the
connection.

## Permissions

- **Read access** lets an assistant read pages, folders, and workspace identity.
- **Write access** lets an assistant create, edit, move, import, and remove
  pages and folders. Write access includes read access.

Some assistants may also ask to stay connected. This lets the connection
refresh its access after a browser session expires. It does not grant access to
pages, and Metakip shows it separately on the consent screen.

## Access Changes And Revocation

When access is revoked, an already connected assistant may not notice until its
next operation. When access is no longer valid, discard the old connection and
start OAuth again instead of retrying the operation.

## Available Operations

MCP provides workspace operations for:

- Searching and reading pages, and finding folders.
- Creating and updating pages and folders.
- Moving, copying, restoring, and removing pages and folders.
- Listing and managing Trash.
- Importing Markdown and Obsidian content.
- Exporting a page or the workspace.

Mutations preserve Metakip's idempotency and conflict rules. If an operation
reports `outcome_uncertain`, inspect the affected page or folder before trying
it again. Lifecycle batches report each item separately, so check every result
instead of assuming that the whole batch succeeded.

## Protocol Compatibility

Send MCP requests to `/mcp`. Older MCP clients can use the same endpoint
without a persistent session. Health and OAuth requests use their documented
paths instead.

## Self-Hosting And Local Development

For local development, run the MCP service with these settings:

```dotenv
MCP_PUBLIC_URL=http://localhost:3002
MCP_PORT=3002
MCP_API_URL=http://127.0.0.1:3001
MCP_API_INTERNAL_SECRET=development-only-mcp-api-secret-0123456789abcdef
BETTER_AUTH_ISSUER=http://localhost:5173/api/auth
BETTER_AUTH_JWKS_URL=http://127.0.0.1:3001/api/auth/jwks
```

HTTP MCP URLs are accepted only for `localhost`, `127.0.0.1`, and `::1`.
Non-loopback MCP URLs must use HTTPS.

For a self-hosted deployment, see the [deployment guide](/self-hosting/deploy-metakip-on-a-vps/).

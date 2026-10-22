---
title: How To Use Metakip With Grok Build
description: Connect Grok Build to Metakip through MCP or its terminal CLI.
---

Grok Build is xAI's terminal coding agent. It is separate from the Grok web
connector flow and the Grok Bot desktop app. Choose MCP or the Metakip CLI.
See [MCP vs CLI](/agents/mcp-vs-cli/) for how the two methods compare.

For installation and sign-in, see xAI's
[Grok Build overview](https://docs.x.ai/build/overview).

## Connect Grok Build to Metakip with MCP

Add Metakip's remote MCP server:

```sh
grok mcp add --transport http metakip https://mcp.metakip.com/mcp
```

Start Grok Build:

```sh
grok
```

On first use, Grok Build opens the OAuth sign-in flow in a browser. Complete
the authorization.

You can also open `/mcps` in Grok Build's terminal UI to inspect MCP servers or
start OAuth sign-in from the server list.

Once connected, ask Grok Build normally. For example:

> What have I decided about the project plan so far?

Grok Build stores user-level MCP configuration by default. For project-specific
configuration, xAI documents `--scope project`; see its
[MCP server guide](https://docs.x.ai/build/features/mcp-servers).

## Use the Metakip CLI from Grok Build

To use the Metakip CLI instead of MCP, install it in the same environment where
Grok Build runs, then sign in with a named Metakip API token:

```sh
metakip login
```

Create the token in **Metakip Settings → API tokens**. Enter it at the CLI
prompt, not in a Grok Build prompt or project file. Describe the task you want
done; Grok Build can choose which CLI commands to use. For example:

> What have I decided about the project plan so far?

See [Metakip CLI](/agents/cli/) for installation, token setup, and
additional commands.

## Troubleshooting

- Run `grok mcp doctor metakip` to diagnose MCP connection issues.
- Open `/mcps`, select Metakip, and press `i` to sign in to its OAuth server.
- Check that the server URL is `https://mcp.metakip.com/mcp` and that the
  machine running Grok Build can reach it.

For xAI's current instructions, see its [MCP Servers guide](https://docs.x.ai/build/features/mcp-servers)
and [CLI reference](https://docs.x.ai/build/cli/reference).

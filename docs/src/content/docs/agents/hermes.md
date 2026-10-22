---
title: How To Use Metakip With Hermes Agent
description: Connect Hermes Agent to Metakip through remote MCP or use the Metakip CLI from its terminal.
---

Hermes Agent supports remote MCP servers and terminal commands. Choose Metakip
MCP or the Metakip CLI; see [MCP vs CLI](/agents/mcp-vs-cli/) for how they
compare.

## Connect Hermes Agent To Metakip With MCP

Add Metakip as a remote MCP server with OAuth:

```sh
hermes mcp add metakip --url https://mcp.metakip.com/mcp --auth oauth
```

Complete the OAuth flow in your browser. If you need to start it manually, run:

```sh
hermes mcp login metakip
```

Once connected, ask Hermes Agent normally. For example:

> What have I decided about the project plan so far?

Hermes loads MCP servers at startup. If you add Metakip while a session is
already running, use `/reload-mcp` or start a new session.

See Hermes Agent's [MCP guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)
for additional setup options.

## Use The Metakip CLI Instead

If you prefer the CLI, install it in the environment where Hermes Agent can run
terminal commands, then sign in with a named Metakip API token:

```sh
metakip login
```

Describe the task you want done; Hermes Agent can choose which CLI commands to
use. For example:

> What have I decided about the project plan so far?

See [Metakip CLI](/agents/cli/) for installation and command details.

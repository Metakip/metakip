---
title: How To Use Metakip With OpenCode
description: Connect OpenCode 2 to Metakip through remote MCP or use the Metakip CLI from a terminal.
---

OpenCode 2 supports remote MCP servers and has access to terminal commands.
Choose Metakip MCP or the Metakip CLI; see [MCP vs CLI](/agents/mcp-vs-cli/)
for how they compare.

## Connect OpenCode to Metakip With MCP

Add Metakip as a global remote MCP server:

```sh
opencode mcp add metakip --global --url https://mcp.metakip.com/mcp
```

Start OAuth authorization:

```sh
opencode mcp auth metakip
```

Complete authorization in the browser. You can also authenticate from OpenCode
with `/mcps`. Once connected, ask OpenCode normally. For example:

> What have I decided about the project plan so far?

See OpenCode's [MCP server guide](https://dev.opencode.ai/v2/docs/mcp-servers/)
for additional configuration options.

## Use the Metakip CLI Instead

If you prefer the CLI, install it in the environment where OpenCode runs and
sign in with a named API token:

```sh
metakip login
```

Describe the task you want done; OpenCode can choose which CLI commands to use.
For example:

> What have I decided about the project plan so far?

See [Metakip CLI](/agents/cli/) for installation and command details.

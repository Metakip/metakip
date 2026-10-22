---
title: How To Use Metakip With OpenClaw
description: Connect OpenClaw to Metakip through remote MCP or use the Metakip CLI from its terminal.
---

OpenClaw can connect to Metakip through MCP or run the Metakip CLI from a
terminal. Choose either; see [MCP vs CLI](/agents/mcp-vs-cli/) for how they
compare. Configure MCP on the Gateway that runs your OpenClaw agents.

## Connect OpenClaw To Metakip With MCP

When the local Gateway is stopped, add Metakip from the terminal:

```sh
openclaw mcp add metakip \
  --url https://mcp.metakip.com/mcp \
  --transport streamable-http \
  --auth oauth
openclaw mcp login metakip
```

Complete the OAuth approval in your browser. These CLI commands require the
local Gateway to be stopped while they update the server configuration or OAuth
credentials.

If your Gateway is running, use the Control UI instead. Open **Settings →
MCP**, edit the `mcp` configuration, and add this server definition:

```json
{
  "servers": {
    "metakip": {
      "url": "https://mcp.metakip.com/mcp",
      "transport": "streamable-http",
      "auth": "oauth",
      "enabled": true
    }
  }
}
```

Select **Save & Publish**, then choose **Sign in** for Metakip and approve
OAuth in your browser. Browser sign-in requires an administrator connection
to the Gateway's own HTTPS, loopback, or published Tailscale address.

Once connected, ask OpenClaw normally. For example:

> What have I decided about the project plan so far?

See OpenClaw's [MCP setup guide](https://docs.openclaw.ai/tools/mcp) and
[Control UI guide](https://docs.openclaw.ai/cli/mcp/control-ui) for other
configuration options.

## Use The Metakip CLI Instead

If the OpenClaw agent can run terminal commands, install the Metakip CLI in
its environment and sign in with a named Metakip API token:

```sh
metakip login
```

Describe the task you want done; OpenClaw can choose which CLI commands to use.
For example:

> What have I decided about the project plan so far?

See [Metakip CLI](/agents/cli/) for installation and command details.

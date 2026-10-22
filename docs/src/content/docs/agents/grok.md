---
title: How To Use Metakip With Grok
description: Connect Grok to Metakip with a custom MCP connector.
---

Grok connects to external tools through **connectors**. Add Metakip as a custom
MCP connector, then Grok can use its tools in conversations when relevant.

## Connect Grok to Metakip

### Open Grok Connectors

Go to [grok.com/connectors](https://grok.com/connectors) and sign in to your
Grok account.

### Add Metakip as a custom MCP connector

Select **New Connector → Custom**, then enter Metakip's MCP server URL:

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/grok/new-connector-choice-light.png" alt="Grok's New Connector dialog in light mode with the Custom connector option." />
  <img class="mode-paired-image__dark" src="/images/grok/new-connector-choice-dark.png" alt="Grok's New Connector dialog in dark mode with the Custom connector option." />
</div>

Name the connection **Metakip** and paste this URL:

```text
https://mcp.metakip.com/mcp
```

Complete the authentication flow when prompted. Metakip uses OAuth; review the
requested permissions before approving access.

<div class="mode-paired-image">
  <img src="/images/grok/oauth-consent-dark.png" alt="Metakip's OAuth consent screen for Grok in dark mode, showing read, comment, and write access." />
</div>

Grok must be able to reach the MCP server over the public internet. Metakip's
hosted server is already reachable, so you do not need to set up a tunnel.

### Confirm the connection

Return to [grok.com/connectors](https://grok.com/connectors). Metakip should
appear under **Connected**.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/grok/connectors-light.png" alt="Grok's Connectors directory in light mode, showing Metakip under Connected." />
  <img class="mode-paired-image__dark" src="/images/grok/connectors-dark.png" alt="Grok's Connectors directory in dark mode, showing Metakip under Connected." />
</div>

### Use Metakip in a conversation

In a conversation, open **Attach → Connectors** and check that **Metakip** is
enabled. You can call it directly by typing `@` and choosing **Metakip**, or
mention it as `@Metakip` in your message. Grok can also use its tools when they
are relevant to your request.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/grok/connector-enabled-light.png" alt="Grok's Connectors menu in light mode with Metakip enabled." />
  <img class="mode-paired-image__dark" src="/images/grok/connector-enabled-dark.png" alt="Grok's Connectors menu in dark mode with Metakip enabled." />
</div>

For example:

> @Metakip, what have I decided about the project plan so far?

## Grok plans and platforms

Connectors are available to Grok users. For Grok Business and Enterprise,
an organization admin must first provision the connector in the cloud console;
team members can then connect their own accounts at
[grok.com/connectors](https://grok.com/connectors).

xAI's connector announcement lists Grok Web, iOS, and Android. xAI also offers
a separate **Grok Build** terminal coding agent and a **Grok Bot** desktop app.
Grok Build has its own MCP and CLI setup; see
[How To Use Metakip With Grok Build](/agents/grok-build/). Grok Bot runs on a
persistent cloud computer and has its own plugin setup; its Team Bot docs
explicitly describe custom MCP plugins. This guide covers the standard Grok
connector flow. See
[Grok Bot's computer and app guide](https://docs.x.ai/grok-bot/computer-and-apps)
and [Team Bots](https://docs.x.ai/grok-bot/team-bots) for its separate setup.

## Troubleshooting

- If your organization does not list Metakip as an available connector, ask a
  Grok Business or Enterprise admin to provision the custom MCP connector.
- If Grok cannot reach the connector, check that the server URL is correct and
  publicly accessible.
- If OAuth access has expired or was revoked, reconnect Metakip and complete
  authorization again.

For xAI's current instructions, see [Connectors](https://docs.x.ai/grok/connectors),
[Connector Management](https://docs.x.ai/grok/connector-management), and
[Connectors in web, iOS, and Android](https://x.ai/news/grok-connectors).

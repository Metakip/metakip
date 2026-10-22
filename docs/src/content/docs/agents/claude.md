---
title: How To Use Metakip With Claude Web and Desktop
description: Connect Claude on the web and desktop to Metakip using a remote MCP connector.
---

Claude calls remote MCP integrations **connectors**. Add Metakip as a custom
connector once, then enable it in conversations on Claude Web or the Claude
Desktop app. The same account-level connector works in both clients; you do not
need to install a local desktop extension for Metakip's hosted server.

## Connect Claude to Metakip

### Open Connectors settings

In Claude, open **Settings → Connectors**. You can manage remote connectors
from Claude Web or Claude Desktop.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/claude/connectors-light.png" alt="Claude's Connectors settings in light mode, with the Add connector button." />
  <img class="mode-paired-image__dark" src="/images/claude/connectors-dark.png" alt="Claude's Connectors settings in dark mode, with the Add connector button." />
</div>

### Add a custom connector

Select **Add connector → Add custom connector**.

Name the connector **Metakip** and enter the MCP server URL:

```text
https://mcp.metakip.com/mcp
```

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/claude/custom-connector-form-light.png" alt="Claude's Add custom connector form in light mode, filled with the Metakip name and MCP server URL." />
  <img class="mode-paired-image__dark" src="/images/claude/custom-connector-form-dark.png" alt="Claude's Add custom connector form in dark mode, filled with the Metakip name and MCP server URL." />
</div>

### Choose OAuth settings

On the next screen, Claude detects OAuth for Metakip. Keep **Sign in now** and
**Use Claude's published identity** selected, then choose **Add**.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/claude/connector-auth-settings-light.png" alt="Claude's custom connector authentication step in light mode, with Sign in now and Use Claude's published identity selected." />
  <img class="mode-paired-image__dark" src="/images/claude/connector-auth-settings-dark.png" alt="Claude's custom connector authentication step in dark mode, with Sign in now and Use Claude's published identity selected." />
</div>

### Authorize Metakip

Complete Metakip's OAuth sign-in when prompted. Review the requested access
before approving it. The consent screen can include read, comment, and write
permissions; approve only the access you want Claude to have.

<div class="mode-paired-image">
  <img src="/images/claude/oauth-consent-dark.png" alt="Metakip's OAuth consent screen in dark mode, showing read, comment, and write access selected." />
</div>

Connector availability can vary by plan and organization settings. In the Free
Claude account used to verify these steps, **Add custom connector** was
available. Team and Enterprise owners may also need to enable custom connectors
for their organization. See
[Anthropic's custom connector instructions](https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp)
for current availability and organization setup.

## Use Metakip in a conversation

### Enable Metakip for the conversation

In a conversation, select **+ → Connectors** near the message box and turn on
Metakip. Connectors may be enabled or disabled separately for each conversation.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/claude/connector-tools-enabled-light.png" alt="Claude's Connectors menu in light mode with Metakip enabled for the current conversation." />
  <img class="mode-paired-image__dark" src="/images/claude/connector-tools-enabled-dark.png" alt="Claude's Connectors menu in dark mode with Metakip enabled for the current conversation." />
</div>

Once connected, ask Claude normally. For example:

> What have I decided about the project plan so far?

### Choose when Claude loads connector tools

In the same **+ → Connectors** menu, open **Tool access**. **Load tools when
needed** keeps the tools available without loading them into every conversation
up front; **Tools already loaded** makes them available earlier but uses more
context.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/claude/connector-tool-access-light.png" alt="Claude's Tool access submenu in light mode, showing Load tools when needed selected." />
  <img class="mode-paired-image__dark" src="/images/claude/connector-tool-access-dark.png" alt="Claude's Tool access submenu in dark mode, showing Load tools when needed selected." />
</div>

## Troubleshooting

- If **Add custom connector** is unavailable, check Claude's current
  availability rules and, for Team or Enterprise, ask your organization owner
  whether custom connectors are enabled.
- If Metakip is connected but unavailable in a conversation, open **+ →
  Connectors** and make sure it is enabled there.
- If OAuth access has expired or was revoked, reconnect Metakip and complete
  authorization again.

For more about the difference between remote connectors and local desktop
extensions, see Anthropic's guide to
[web and desktop connectors](https://support.anthropic.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).

For Claude Code's MCP and terminal-based CLI options, see
[How To Use Metakip With Claude Code](/agents/claude-code/).

---
title: How To Use Metakip With ChatGPT Web
description: Connect ChatGPT on the web to Metakip with a custom remote MCP server.
---

ChatGPT on the web can connect to Metakip through its remote MCP server. Metakip
does not currently publish a first-party ChatGPT app or plugin; add it as a custom
MCP server instead.

## Connect ChatGPT to Metakip

### Open the Plugins directory

In ChatGPT on the web, open **Plugins**, select **Add** in the upper-right
corner, and choose **Add custom MCP server**.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/chatgpt/plugins-directory-light.png" alt="ChatGPT's Plugins directory with the Add button in the upper-right corner." />
  <img class="mode-paired-image__dark" src="/images/chatgpt/plugins-directory-dark.png" alt="ChatGPT's Plugins directory with the Add button in the upper-right corner." />
</div>

### Enter Metakip's server details

Name the connection **Metakip**, select **Server URL**, and enter:

```text
https://mcp.metakip.com/mcp
```

Leave **Authentication** set to **OAuth**.

The icon is optional. To add Metakip's logo, download a PNG from
[Metakip Brand Assets](https://metakip.com/brand), then upload it using **Choose
icon** in the setup dialog. ChatGPT currently accepts PNG files up to 10 KB; the
hosted 512 × 512 PNGs are larger, so upload a compressed copy or leave the icon
blank.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/chatgpt/mcp-setup-form-light.png" alt="Add custom MCP server dialog filled with Metakip's name, server URL, and OAuth authentication." />
  <img class="mode-paired-image__dark" src="/images/chatgpt/mcp-setup-form-dark.png" alt="Add custom MCP server dialog filled with Metakip's name, server URL, and OAuth authentication." />
</div>

### Create the connection and authorize Metakip

Review the custom-server warning, check **I understand and want to continue**,
and select **Create as a plugin**. Complete Metakip's OAuth sign-in when
prompted, and review the requested access before approving it.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/chatgpt/oauth-consent-light.png" alt="Metakip OAuth consent screen with Read Access, Comment Access, and Write Access selected." />
  <img class="mode-paired-image__dark" src="/images/chatgpt/oauth-consent-dark.png" alt="Metakip OAuth consent screen with Read Access, Comment Access, and Write Access selected." />
</div>

The current consent screen lists **Read Access**, **Comment Access**, and
**Write Access**, all selected by default. Review the selected permissions before
connecting; approve only if that access is appropriate for your Metakip account.

### Use Metakip in a chat

Review the tools ChatGPT discovers. In a new conversation, type `@` in the
message box and select **Metakip** from the plugin menu. ChatGPT will insert
`@Metakip`; continue with your request.

For example:

> @Metakip, what have I decided about the project plan so far?

## Refresh Metakip's MCP tools

ChatGPT may keep the previous MCP tool list after Metakip's tools or their
descriptions change. Open **Plugins**, select **Metakip**, choose **Manage**,
and select **Refresh tools** in the **Manage app** section. Wait for the refresh
to finish, then review the tool list.

<div class="mode-paired-image">
  <img class="mode-paired-image__light" src="/images/chatgpt/refresh-tools-light.png" alt="Metakip's Manage app settings with the Refresh tools control." />
  <img class="mode-paired-image__dark" src="/images/chatgpt/refresh-tools-dark.png" alt="Metakip's Manage app settings with the Refresh tools control." />
</div>

After refreshing, start a new conversation, type `@`, select **Metakip**, and
test a request that uses the changed or added tool.

## Troubleshooting

- **Add custom MCP server** was available on the Free account used to verify
  these steps. If it is missing for you, make sure you are in ChatGPT on the web
  and check for workspace restrictions; do not assume a paid plan is required.
- If Metakip is connected but ChatGPT cannot use it, check that the connection is
  enabled for the current chat and that you completed Metakip's OAuth consent.
- If access has expired or was revoked, remove the old connection and connect
  again. Do not retry with an old authorization.

For OpenAI's current setup steps and availability, see
[Connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
and [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).

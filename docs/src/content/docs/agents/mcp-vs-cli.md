---
title: 'MCP vs CLI: Choose How To Connect Metakip'
description: Compare Metakip MCP and CLI, including the CLI's standalone image upload capability.
---

Metakip MCP and the CLI share core page and workspace operations, but not every
capability. If your assistant supports both, you usually need only one
connection. Choose the CLI when you need to upload a standalone image to an
existing page.

## How They Connect

| MCP | CLI |
| --- | --- |
| Connect Metakip through an assistant's MCP integration or plugin. | Run Metakip commands in a terminal available to you or your assistant. |
| Sign in through OAuth. | Sign in with a named Metakip API token. |

Choose based on what your assistant supports and where you want to work. For
example, ChatGPT Web uses the Metakip plugin. In terminal-enabled environments
such as ChatGPT Work or Codex, Claude Code, Grok Build, or Pi, you can choose
MCP or the CLI. OpenClaw can also use either method, configured on the Gateway
that runs its agents.

## Standalone Image Upload

The CLI has a direct image-upload command for an existing page:

```sh
metakip upload image ./diagram.png --page PAGE_ID --alt "System diagram"
```

It uploads the image as a managed attachment and prints a Markdown image
reference. Add that reference to the page with a targeted page edit.

MCP does not have an equivalent tool for uploading a standalone image directly
to an existing page. It can import supported image files as part of an
Obsidian folder import.

## Setup Guides

- [Connect with MCP](/agents/mcp/)
- [Install and use the CLI](/agents/cli/)
- [ChatGPT Web](/agents/chatgpt-web/) and [ChatGPT Desktop App](/agents/chatgpt-app/)
- [Claude Web and Desktop](/agents/claude/) and [Claude Code](/agents/claude-code/)
- [Grok](/agents/grok/) and [Grok Build](/agents/grok-build/)
- [Hermes Agent](/agents/hermes/)
- [OpenCode](/agents/opencode/)
- [OpenClaw](/agents/openclaw/)
- [Pi](/agents/pi/)

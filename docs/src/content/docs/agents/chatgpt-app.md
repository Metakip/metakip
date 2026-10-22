---
title: How To Use Metakip With ChatGPT Desktop App
description: Use the Metakip plugin in regular chats, and choose plugin or CLI in terminal-enabled Work and Codex.
---

The ChatGPT desktop app includes different experiences, and the available
Metakip connection depends on which one you use:

- In a regular **ChatGPT chat**, use the **Metakip plugin** (MCP). These chats do
  not have general access to your computer's terminal.
- In **ChatGPT Work** or **Codex**, choose the Metakip plugin/MCP or the
  **Metakip CLI** in the available terminal.

For the differences between the plugin and CLI, see [MCP vs CLI](/agents/mcp-vs-cli/).

## Use the Metakip Plugin in ChatGPT

Connect Metakip as a custom plugin backed by its remote MCP server. Follow
[the ChatGPT Web connection steps](/agents/chatgpt-web/) to add the plugin and
complete OAuth authorization. The same Metakip plugin can then be selected in a
desktop chat.

In a new ChatGPT conversation, type `@` in the message box, select **Metakip**,
and continue with your request. For example:

> @Metakip, what have I decided about the project plan so far?

## Use the Metakip CLI in ChatGPT Work or Codex

When the current ChatGPT Work or Codex session provides a terminal, you can use
the Metakip CLI instead of the plugin. Install the CLI in the environment where
that terminal runs, following
[Metakip CLI installation instructions](/agents/cli/#install-the-cli).

Create a named API token in **Metakip Settings → API tokens**. Start with
read-only access unless you need the assistant to make changes. In the terminal,
sign in:

```sh
metakip login
```

Enter the token at the CLI prompt. Do not put it in a chat message, shell
command, or project file. Describe the task you want done; Work or Codex can
choose which CLI commands to use. For example:

> What have I decided about the project plan so far?

The CLI can also create pages and make targeted edits when the token has write
access. Ask Work or Codex to read a page immediately before changing it, then
review the result in Metakip. See [Metakip CLI](/agents/cli/) for more
commands and safe editing guidance.

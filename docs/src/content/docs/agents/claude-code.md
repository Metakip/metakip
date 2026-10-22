---
title: How To Use Metakip With Claude Code
description: Connect Claude Code to Metakip through MCP or its terminal CLI.
---

Claude Code is available in the Claude Desktop app's **Code** experience and as
a command-line tool. Choose MCP or the Metakip CLI in its terminal. See
[MCP vs CLI](/agents/mcp-vs-cli/) for how the two methods compare.

## Connect Claude Code to Metakip With MCP

From a terminal where Claude Code is installed, add Metakip as a remote HTTP
MCP server:

```sh
claude mcp add --transport http --scope user metakip https://mcp.metakip.com/mcp
```

Start or return to Claude Code, then enter `/mcp` and follow the prompt to
authorize Metakip with OAuth.

For example, ask Claude Code:

> What have I decided about the project plan so far?

See Anthropic's [Claude Code MCP guide](https://code.claude.com/docs/en/mcp) for
other connection options and troubleshooting.

## Use the Metakip CLI in Claude Code

The CLI uses a named Metakip API token. Create a token in **Metakip Settings →
API tokens**. Start with read-only access unless you need Claude Code to make
changes.

Install the Metakip CLI in the environment where Claude Code's terminal runs,
following [Metakip CLI installation instructions](/agents/cli/#install-the-cli).
Then sign in:

```sh
metakip login
```

Enter the token at the CLI prompt. Do not paste it into a chat message, shell
command, or project file. Describe the task you want done; Claude Code can
choose which CLI commands to use. For example:

> What have I decided about the project plan so far?

The CLI can also create pages and make targeted edits when the token has write
access. Ask Claude Code to read a page immediately before changing it, then
review the result in Metakip. See [Metakip CLI](/agents/cli/) for more
commands and safe editing guidance.

## Local And Cloud Sessions

Claude Code can run in a local or cloud environment. The terminal commands above
run in the environment used by the current session. A local CLI installation
and its sign-in are not automatically available in a cloud session; install and
authenticate the CLI in the environment where you intend to use it.

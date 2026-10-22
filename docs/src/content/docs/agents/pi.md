---
title: How To Use Metakip With Pi
description: Connect Pi to Metakip with its built-in MCP client or the Metakip CLI.
---

Pi is a terminal-based coding agent. Choose Pi's built-in MCP client or the
Metakip CLI from Pi's shell. See [MCP vs CLI](/agents/mcp-vs-cli/) for how the
two methods compare.

If you have not installed Pi or configured a model provider yet, start with
[Pi's Quickstart](https://pi.dev/docs/latest/quickstart).

## Connect Pi to Metakip with MCP

Add Metakip's remote MCP server and sign in with OAuth:

```sh
pi mcp add metakip --url https://mcp.metakip.com/mcp
pi mcp login metakip
```

`pi mcp add` saves a user-level connection by default. `pi mcp login` opens the
OAuth sign-in flow; complete it in the browser.

Once connected, ask Pi normally. For example:

> What have I decided about the project plan so far?

Pi includes built-in MCP support; you do not need to install a separate MCP
client extension.

## Use the Metakip CLI from Pi's terminal

To use the CLI instead of MCP, install it in the same environment where Pi runs,
then sign in with a named Metakip API token:

```sh
metakip login
```

Create the token in **Metakip Settings → API tokens**. Enter it at the CLI
prompt; do not paste it into a Pi prompt or save it in a project file. Pi can
choose which CLI commands to use based on the task. For example, ask:

> What have I decided about the project plan so far?

Follow [Metakip CLI](/agents/cli/) for installation, token setup, and
more commands.

## Project-level MCP configuration

The commands above store the connection for your user. If a project specifically
needs its own MCP configuration, add it to `.pi/mcp.json` with `--local`:

```sh
pi mcp add --local metakip --url https://mcp.metakip.com/mcp
```

Pi only loads project MCP configuration after you trust the project. Keep
personal connections and credentials in your user-level configuration unless
the project requires otherwise. See Pi's [project-trust guidance](https://pi.dev/docs/latest/security#project-trust).

## Troubleshooting

- Run `pi mcp list` to check connection status and errors. If sign-in is needed,
  run `pi mcp login metakip`.
- In an interactive session, use `/mcp` to inspect the connection or reconnect.
  Use `/reload` after changing the MCP configuration outside the session.
- If you configured Metakip at project level, make sure you trusted that
  project when Pi prompted you.

For more Pi command options, see the official [CLI reference](https://pi.dev/docs/latest/cli).

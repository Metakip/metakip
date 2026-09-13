---
title: Connect AI Assistants To Metakip
description: Connect a terminal-based AI assistant to Metakip with the CLI, scoped API tokens, read access, and safe exact edits.
---

You can use Metakip with an AI assistant that can work with a terminal, such as Claude Code or Codex. The current path uses the Metakip CLI and its optional skill.

## How It Works

1. Install the CLI.
2. Create a named token in **Metakip Settings → API tokens**.
3. Sign in with `metakip login`.
4. Let the tool read or change pages through the CLI.
5. Review the result in Metakip.

There is no separate AI notebook to keep in sync.

## Start With Read Access

New tokens are read-only by default. Read access is enough for a tool to find pages, read content, understand folders, and answer questions from existing information.

Give a token write access only when you want the tool to create or edit pages.

Read access is the right starting point for an assistant that only needs to answer questions from your pages. Add write access after you have tested the read workflow and decided which pages it should change.

## Use Targeted Changes

For an edit:

1. Read the current page.
2. Identify the exact passage to change.
3. Ask the tool to replace that passage.
4. Check the result.

Do not ask a tool to rewrite an important page from memory when a targeted edit will do.

## Keep Secrets Private

Never paste your token into a chat, commit it to a repository, or put it in a command that can be saved in shell history.

See [Metakip CLI](/agents/metakip-cli/) for setup and the [generated API Reference](/api-reference/endpoints/) for endpoint details.

## What The Assistant Can Do

With read access, an assistant can list pages, view page content, inspect folders, and answer from the information it can access. With write access, it can create pages or apply targeted changes. It cannot bypass the permissions attached to the token or pages.

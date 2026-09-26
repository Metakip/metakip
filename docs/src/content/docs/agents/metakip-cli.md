---
title: 'Metakip CLI: Install And Manage Pages'
description: Install the Metakip CLI, sign in with a scoped token, read and edit pages, import and export markdown, and connect AI assistants.
---

The Metakip CLI lets you use Metakip from a terminal. The browser and CLI use the same content layer, so a page created or edited by the CLI appears in the browser.

## Before You Begin

You need a Metakip account and a named API token from **Metakip Settings → API tokens**. The token is shown only when it is created. Keep it private.

## Install The CLI

On Linux and macOS:

```sh
curl -fsSL https://metakip.com/install.sh | sh
```

On Windows PowerShell:

```powershell
irm https://metakip.com/install.ps1 | iex
```

The installer adds the CLI directory to your shell profile, but profile changes apply only to future sessions. Open a new terminal, or reload the appropriate profile (`source ~/.bashrc`, `source ~/.zshrc`, or `. $PROFILE` in PowerShell), before invoking `metakip` by name.

Check the installation:

```sh
metakip --version
```

You should see the installed CLI version. If the command is not found, open a new terminal or reload the profile that the installer changed.

## Sign In To Metakip

Create a named token in **Metakip Settings → API tokens**, then run:

```sh
metakip login
```

For a self-hosted server:

```sh
metakip login --url https://your-metakip.example.com
```

Check the connection without printing the token:

```sh
metakip whoami
metakip doctor
```

## Read Pages

```sh
metakip page search "project notes"
metakip page list
metakip page view "Page Title"
metakip --json page search "project notes"
metakip --json page list
metakip --json page view PAGE_ID
```

`page search` searches page titles only and returns at most 20 matching pages, including their
folder paths. Use a returned page ID with `page view` or another page command. Use page IDs in
scripts; titles are convenient for interactive use but can be ambiguous.

## Create And Edit Pages

```sh
metakip page create --title "Research Notes" --content-file notes.md
```

For a small, targeted change:

```sh
metakip page edit exact PAGE_ID \
  --old-text "The old exact passage." \
  --new-text "The revised passage."
```

Read the page immediately before editing. The CLI refuses to guess if the passage is missing, repeated, or changed.

## Import And Export

```sh
metakip import page notes.md
metakip import folder ./notes
metakip upload image ./diagram.png --page PAGE_ID --alt "System diagram"
metakip export page PAGE_ID --output page.md
metakip export all --output metakip-export.zip
```

The upload command prints a managed Markdown image reference. Insert that reference with a targeted
page edit. If the image is already reliably hosted for every intended reader, you can instead add
`![Diagram](https://example.com/diagram.png)` directly. Avoid base64 data images because they bloat
the collaborative page document.
Private managed image URLs require access to a referenced page. API clients can download them with
an API token that has `pages:read`; the CLI's upload permission alone does not grant read access.

## Agent Skill

Install the Metakip skill for tools that support Agent Skills:

```sh
metakip skill install
```

The skill gives supported tools instructions for safe page discovery and exact edits. It does not create a separate copy of your pages.

## Keep Tokens Safe

Do not paste a token into a chat, commit it to a repository, or put it directly in a command that could be saved in shell history. For non-interactive use, set `METAKIP_TOKEN` and, for a self-hosted server, `METAKIP_URL` in the environment.

## Related Guides

- [Connect AI Assistants To Metakip](/agents/use-metakip-with-ai-assistants/) explains read and write access.
- [Markdown Support In Metakip](/getting-started/markdown-support/) lists supported content syntax.
- [API Reference](/api-reference/endpoints/) documents the direct HTTP interface.

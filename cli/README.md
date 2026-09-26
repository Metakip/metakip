# Metakip CLI

The official terminal client for Metakip. The browser and CLI use the same content layer: a page
written in the browser and a page read, edited, or linked by an agent are the same page. There is
no separate agent mode, adapter, or second data store.

Terminal output is readable by default, redirected output is plain and untruncated, and `--json`
provides structured output for scripts and agents.

## Install

Linux and macOS:

```sh
curl -fsSL https://metakip.com/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://metakip.com/install.ps1 | iex
```

The standalone installer downloads the matching release archive, verifies its SHA-256
checksum, and installs Metakip to `~/.metakip/bin` on Linux/macOS or
`%LOCALAPPDATA%\Metakip\bin` on Windows. It automatically adds a clearly marked PATH block to
your shell or PowerShell profile. To leave PATH unchanged, opt out explicitly:

```sh
curl -fsSL https://metakip.com/install.sh | METAKIP_MODIFY_PATH=0 sh
```

In PowerShell, run `$env:METAKIP_MODIFY_PATH = 0` before the installer command.

PATH changes apply to future terminal sessions. Open a new terminal before invoking `metakip` by
name.

To install the optional agent skill in the same non-interactive bootstrap, choose a scope with
`METAKIP_INSTALL_SKILL`. This requires Node.js and `npx`; an explicit skill request fails loudly
after the CLI is installed if `npx skills` cannot finish.

```sh
# Install the CLI and a global agent skill.
curl -fsSL https://metakip.com/install.sh | METAKIP_INSTALL_SKILL=global sh

# Install the skill in the current project instead.
curl -fsSL https://metakip.com/install.sh | METAKIP_INSTALL_SKILL=project sh
```

In PowerShell:

```powershell
$env:METAKIP_INSTALL_SKILL = 'global'; irm https://metakip.com/install.ps1 | iex
```

To install a specific release, set `METAKIP_VERSION`, for example:

```sh
curl -fsSL https://metakip.com/install.sh | METAKIP_VERSION=v1.2.3 sh
```

Installer configuration:

| Variable | Purpose |
| --- | --- |
| `METAKIP_VERSION` | Install a semantic version such as `v1.2.3`; the default is the latest stable release. |
| `METAKIP_INSTALL_DIR` | Override the platform-default binary directory. |
| `METAKIP_INSTALL_STATE_DIR` | Override the directory containing the standalone install receipt. |
| `METAKIP_MODIFY_PATH` | Set to `0` to leave PATH unchanged; the default is `1`, which adds a marked PATH block to the detected shell profile. |
| `METAKIP_INSTALL_SKILL` | Set to `global` or `project` to invoke `npx skills` after a successful CLI installation; leave unset or set to `0` to skip it. |
| `METAKIP_PROFILE_PATH` | Override the PowerShell profile modified on Windows. |
| `METAKIP_HTTP_TIMEOUT_SECONDS` | Set a positive timeout for each installer download. |

Go users can also install from source:

```sh
go install github.com/Metakip/metakip/cli@latest
```

Release archives are built for Linux, macOS, and Windows on amd64 and arm64. Verify an installation with:

```sh
metakip --version
```

Release archives, checksum manifests, and installer scripts carry GitHub build-provenance
attestations. To independently verify a downloaded file before using it:

```sh
gh attestation verify metakip_1.2.3_linux_amd64.tar.gz --repo Metakip/metakip
```

## Agent skills

Metakip ships an [Agent Skills](https://agentskills.io) compatible `metakip` skill. If Node.js
is available, install or update it with:

```sh
metakip skill install
metakip skill install --global
metakip skill update
```

The skill documents the safe workflow for discovery and targeted edits. It is optional; the CLI
has no Node.js dependency.

## Authenticate

Create a named token in **Metakip Settings → API tokens**, then run:

```sh
metakip login
```

`metakip login` defaults to `https://app.metakip.com`. Pass `--url URL` or set `METAKIP_URL`
for a self-hosted server.

The token is validated before it is saved. The config directory is created with mode `0700` and the config file with mode `0600`.

For CI and short-lived agent sessions, avoid writing a config file:

```sh
export METAKIP_URL=https://metakip.example.com
export METAKIP_TOKEN=mdn_...
metakip --json page list
```

Environment variables override saved configuration. Do not pass tokens as command-line arguments, where they may be exposed in process listings and shell history.

## Commands

```text
# Authentication
metakip login [--url URL]
metakip logout
metakip whoami

# Page
metakip page copy <page-id-or-title>... [--parent FOLDER_ID]
metakip page create [--title TITLE] [--parent FOLDER_ID] [--icon ICON] [--content-file FILE]
metakip page delete <page-id-or-title>... [--yes]
metakip page edit <page-id-or-title> [--editor COMMAND]
metakip page edit append <page-id-or-title> {--content-text CONTENT | --content-file FILE}
metakip page edit exact <page-id-or-title> {--old-text OLD | --old-file OLD} {--new-text NEW | --new-file NEW}
metakip page edit exact <page-id-or-title> --expect-empty {--new-text NEW | --new-file NEW}
metakip page edit interactive <page-id-or-title> [--editor COMMAND]
metakip page edit prepend <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
metakip page edit replace <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
metakip page list [--parent FOLDER_ID] [--limit N]
metakip page move <page-id-or-title>... [--parent FOLDER_ID]
metakip page search <query>
metakip page update <page-id-or-title> [--title TITLE] [--icon ICON | --clear-icon]
metakip page view <page-id-or-title> [--raw]

# Folder
metakip folder copy <folder-id-or-name>... [--parent FOLDER_ID]
metakip folder create [--name NAME] [--parent FOLDER_ID]
metakip folder delete <folder-id-or-name>... [--yes]
metakip folder list
metakip folder move <folder-id-or-name>... [--parent FOLDER_ID]
metakip folder update <folder-id-or-name> --name NAME

# Trash
metakip trash delete {page|folder} <id-or-title>... [--yes]
metakip trash empty [--yes]
metakip trash list
metakip trash restore {page|folder} <id-or-title>...

# Import and Export
metakip export all --output FILE [--force]
metakip export page <page-id-or-title> [--output FILE] [--force]
metakip import folder DIRECTORY [--yes]
metakip import page FILE.md
metakip upload image FILE --page PAGE [--alt TEXT]

# Skill
metakip skill install [--global] [--copy] [--yes]
metakip skill update [--global | --project] [--yes]

# Tooling
metakip completion {bash|zsh|fish}
metakip doctor
metakip uninstall [--purge] [--dry-run] [--yes]
metakip update [VERSION]
```

`upload image` prints the managed Markdown reference to stdout; insert it with a targeted page edit.

## Work safely

Use stable page IDs in scripts. Exact titles are a convenience for interactive use; ambiguous
titles prompt for a choice, while `--no-input` fails rather than guessing.

Read before a targeted edit and use `exact` whenever possible:

```sh
metakip page view PAGE_ID --raw
metakip page edit exact PAGE_ID --old-text "Draft" --new-text "Approved"
```

Use `replace` for a deliberate full-document rewrite; use `append` or `prepend` for a document
boundary change. `page edit` opens the configured editor and protects the upload with the current
revision. `page update` changes title or icon only.

Lifecycle and content mutations are never automatically retried. If an operation reports
`outcome_uncertain`, inspect the affected page, folder, or Trash before retrying; a copy may have
already succeeded.

## Output

`--json` writes structured JSON with stable field names and status values, including structured
errors. Human-readable `message` text may change; scripts should use error codes, statuses, and
structured fields instead of matching message text. `--plain` disables rich terminal output;
`NO_COLOR` also disables color. Piped `page view` output is raw markdown.

## Tooling

```sh
# bash
source <(metakip completion bash)

# zsh
source <(metakip completion zsh)

# fish
metakip completion fish | source
```

`metakip doctor` reports the config location, resolved server, authentication status, token
access, standalone-install health, and optional skills-tool availability without printing the
token. JSON output includes structured receipt paths, binary paths, errors, required commands, and
install commands when applicable.

`metakip update` downloads a checksum-verified standalone release. Go-installed binaries should
be updated with `go install github.com/Metakip/metakip/cli@latest` instead. JSON output uses
`target` for the requested channel or pinned version; `version` is included only for pinned updates.

```sh
metakip update
metakip uninstall --dry-run
metakip uninstall --yes
metakip uninstall --purge --yes
```

`uninstall` removes the standalone binary and receipt while preserving local configuration unless
`--purge` is supplied. `--purge` removes only local configuration and credentials; remote workspace
data and unrelated skills are preserved. Use `--yes` non-interactively. If an install, update, or
uninstall is interrupted, rerun the command.

## Environment

| Variable | Purpose |
| --- | --- |
| `METAKIP_TOKEN` | Bearer token; overrides the saved token. |
| `METAKIP_URL` | Server URL; overrides the saved URL. |
| `METAKIP_EDITOR` | Preferred command for editor-mode `page edit`. |
| `VISUAL`, `EDITOR` | Editor fallbacks, in that order. |
| `METAKIP_CONFIG_DIR` | Override the config directory. |
| `NO_COLOR` | Disable color output. |

## Exit statuses

| Status | Meaning |
| --- | --- |
| `0` | Command completed successfully. |
| `1` | API, network, or command failure. |
| `2` | Invalid command arguments. |
| `4` | Authentication or authorization failure. |
| `5` | Revision or exact-edit conflict. |
| `70` | Internal startup failure. |
| `130` | Interrupted by the user. |

Run `metakip <command> --help` for complete command-specific flags.
`metakip help <command...>` is an equivalent command form, for example `metakip help page update`.

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/alecthomas/kong"
	"github.com/charmbracelet/huh"
)

type CLI struct {
	JSON    bool             `short:"j" help:"Write stable JSON to stdout."`
	Plain   bool             `help:"Disable colors and rich Markdown rendering."`
	NoInput bool             `help:"Fail instead of prompting when input or selection is required."`
	URL     string           `help:"Override the Metakip server URL." placeholder:"URL"`
	Timeout time.Duration    `help:"HTTP request and retry timeout." default:"30s"`
	Version kong.VersionFlag `name:"version" short:"v" help:"Print the version."`

	Login  LoginCmd  `cmd:"" help:"Authenticate with a named API token." group:"Authentication"`
	Logout LogoutCmd `cmd:"" help:"Remove the locally stored API token." group:"Authentication"`
	Whoami WhoamiCmd `cmd:"" help:"Show the authenticated user." group:"Authentication"`
	Page   PageCmd   `cmd:"" help:"Read and edit pages." group:"Page"`
	Folder FolderCmd `cmd:"" help:"Read and manage folders." group:"Folder"`
	Trash  TrashCmd  `cmd:"" help:"Manage deleted pages and folders." group:"Trash"`
	Export ExportCmd `cmd:"" help:"Export Metakip content." group:"Import and Export"`
	Import ImportCmd `cmd:"" help:"Import Metakip content." group:"Import and Export"`
	Skill  SkillCmd  `cmd:"" help:"Install or update the optional Metakip agent skill." group:"Skill"`

	Completion CompletionCmd         `cmd:"" help:"Generate a shell completion script." group:"Tooling"`
	Doctor     DoctorCmd             `cmd:"" help:"Check CLI, authentication, and standalone install health." group:"Tooling"`
	Finalize   StandaloneFinalizeCmd `cmd:"" name:"standalone-finalize" hidden:"" group:"Tooling"`
	Uninstall  UninstallCmd          `cmd:"" help:"Remove a standalone Metakip installation." group:"Tooling"`
	Update     UpdateCmd             `cmd:"" help:"Update a standalone Metakip installation." group:"Tooling"`
}

type LoginCmd struct{}

type LogoutCmd struct{}
type WhoamiCmd struct{}

type UpdateCmd struct {
	Version string `arg:"" optional:"" help:"Install this release version instead of the latest stable release." placeholder:"VERSION"`
}

type UninstallCmd struct {
	Purge  bool `help:"Also remove local configuration and credentials; remote workspace data and unrelated skills are preserved."`
	DryRun bool `help:"Show what would be removed without removing it."`
	Yes    bool `help:"Skip the uninstall confirmation prompt."`
}

type StandaloneFinalizeCmd struct {
	InstallDir string `required:""`
	PathFile   string `optional:""`
	PathStyle  string `optional:""`
}

type SkillCmd struct {
	Install SkillInstallCmd `cmd:"" help:"Install the Metakip skill with npx skills."`
	Update  SkillUpdateCmd  `cmd:"" help:"Update an installed Metakip skill with npx skills."`
}

type SkillInstallCmd struct {
	Global bool `short:"g" help:"Install for all projects instead of the current project."`
	Copy   bool `help:"Copy skill files instead of using symlinks where supported."`
	Yes    bool `short:"y" help:"Skip npx skills confirmation prompts."`
}

type SkillUpdateCmd struct {
	Global  bool `short:"g" help:"Update only globally installed skills."`
	Project bool `short:"p" help:"Update only project-installed skills."`
	Yes     bool `short:"y" help:"Skip npx skills confirmation prompts."`
}

type PageCmd struct {
	Copy   PageCopyCmd   `cmd:"" help:"Copy pages."`
	Create PageCreateCmd `cmd:"" help:"Create a page."`
	Delete PageDeleteCmd `cmd:"" help:"Move pages to Trash."`
	Edit   PageEditCmd   `cmd:"" help:"Edit a page's Markdown."`
	List   PageListCmd   `cmd:"" help:"List accessible pages."`
	Move   PageMoveCmd   `cmd:"" help:"Move pages."`
	Search PageSearchCmd `cmd:"" help:"Search page titles."`
	Update PageUpdateCmd `cmd:"" help:"Update a page's title or icon."`
	View   PageViewCmd   `cmd:"" help:"View a page's Markdown."`
}

type FolderCmd struct {
	Copy   FolderCopyCmd   `cmd:"" help:"Copy folders."`
	Create FolderCreateCmd `cmd:"" help:"Create a folder."`
	Delete FolderDeleteCmd `cmd:"" help:"Move folders to Trash."`
	List   FolderListCmd   `cmd:"" help:"List accessible folders."`
	Move   FolderMoveCmd   `cmd:"" help:"Move folders."`
	Update FolderUpdateCmd `cmd:"" help:"Rename a folder."`
}

type TrashCmd struct {
	Delete  TrashDeleteCmd  `cmd:"" help:"Permanently delete trashed items."`
	Empty   TrashEmptyCmd   `cmd:"" help:"Permanently delete all trashed items."`
	List    TrashListCmd    `cmd:"" help:"List trashed pages and folders."`
	Restore TrashRestoreCmd `cmd:"" help:"Restore trashed items."`
}

type ExportCmd struct {
	All  ExportAllCmd  `cmd:"" help:"Export all accessible pages as a ZIP."`
	Page ExportPageCmd `cmd:"" help:"Export one page with its attachments."`
}

type ImportCmd struct {
	Folder ImportFolderCmd `cmd:"" help:"Import a folder or Obsidian vault."`
	Page   ImportPageCmd   `cmd:"" help:"Import one Markdown page."`
}

type CompletionCmd struct {
	Shell string `arg:"" enum:"bash,zsh,fish" help:"Shell to generate completion for."`
}

func (cmd *LoginCmd) Run(r *runtimeState) error {
	cfg, err := r.config()
	if err != nil {
		return err
	}
	baseURL := cfg.BaseURL
	if envURL := os.Getenv("METAKIP_URL"); envURL != "" {
		baseURL = envURL
	}
	if r.cli.URL != "" {
		baseURL = r.cli.URL
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")

	token := strings.TrimSpace(os.Getenv("METAKIP_TOKEN"))
	if token == "" && r.interactive() {
		input := huh.NewInput().Title("API token").Description("Create a named token in Metakip Settings.").EchoMode(huh.EchoModePassword).Value(&token)
		err = huh.NewForm(huh.NewGroup(input)).WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx)
		if errors.Is(err, huh.ErrUserAborted) {
			return &cliError{Code: "aborted", Message: "Login cancelled."}
		}
	} else if token == "" && !r.stdinTTY {
		reader := bufio.NewReader(io.LimitReader(r.stdin, 4097))
		token, err = reader.ReadString('\n')
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		if r.stdinTTY && !r.interactive() {
			return usageError("API token is required in METAKIP_TOKEN when terminal input is disabled.")
		}
		return usageError("API token is required on stdin or in METAKIP_TOKEN.")
	}
	user, err := r.verifyToken(baseURL, token)
	if err != nil {
		statusCode := 0
		var apiError *cliError
		if errors.As(err, &apiError) {
			statusCode = apiError.StatusCode
		}
		return &cliError{
			Code: "token_validation_failed", Message: "Token validation failed",
			StatusCode: statusCode, Cause: err,
		}
	}
	cfg.BaseURL = baseURL
	cfg.Token = token
	if err := saveConfig(cfg); err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(loginResult{Server: baseURL, User: user})
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Logged in to %s as %s <%s>\n",
		terminalText(baseURL),
		terminalText(user.Name),
		terminalText(user.Email),
	)
	return err
}

func (cmd *LogoutCmd) Run(r *runtimeState) error {
	if err := removeConfig(); err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(map[string]bool{"loggedOut": true})
	}
	if _, err := fmt.Fprintln(r.stdout, "Logged out."); err != nil {
		return err
	}
	if os.Getenv("METAKIP_TOKEN") != "" {
		if _, err := fmt.Fprintln(r.stderr, "METAKIP_TOKEN is still set and will continue to authenticate commands."); err != nil {
			return err
		}
	}
	return nil
}

func (cmd *WhoamiCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request(http.MethodGet, "/me", nil, nil)
	if err != nil {
		return err
	}
	var user authenticatedUser
	if err := decodeJSON(response, &user); err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(user)
	}
	server, err := r.serverURL()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"%s <%s>\n%s\n",
		terminalText(user.Name),
		terminalText(user.Email),
		terminalText(server),
	)
	if err != nil {
		return err
	}
	if user.Authentication == "token" {
		if access := tokenAccess(user.Scopes); access != "" {
			_, err = fmt.Fprintf(r.stdout, "Token access: %s\n", terminalText(access))
		}
	}
	return err
}

func (cmd *CompletionCmd) Run(r *runtimeState) error {
	script, err := completionScript(cmd.Shell)
	if err != nil {
		return err
	}
	_, err = fmt.Fprint(r.stdout, script)
	return err
}

func marshalBody(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}
	return data, nil
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"
)

type runtimeState struct {
	ctx         context.Context
	cli         *CLI
	stdin       io.Reader
	stdout      io.Writer
	stderr      io.Writer
	stdinTTY    bool
	stdoutTTY   bool
	stderrTTY   bool
	clientValue *client
	configValue *config
}

func formatHumanError(message string) string {
	return "Error: " + message
}

func newRuntime(ctx context.Context, cli *CLI, stdin, stdout, stderr *os.File) *runtimeState {
	return &runtimeState{
		ctx:       ctx,
		cli:       cli,
		stdin:     stdin,
		stdout:    stdout,
		stderr:    stderr,
		stdinTTY:  term.IsTerminal(int(stdin.Fd())),
		stdoutTTY: term.IsTerminal(int(stdout.Fd())),
		stderrTTY: term.IsTerminal(int(stderr.Fd())),
	}
}

func (r *runtimeState) config() (config, error) {
	if r.configValue != nil {
		return *r.configValue, nil
	}
	cfg, err := loadConfig()
	if err != nil {
		return cfg, err
	}
	r.configValue = &cfg
	return cfg, nil
}

func (r *runtimeState) serverURL() (string, error) {
	cfg, err := r.config()
	if err != nil {
		return "", err
	}
	baseURL := cfg.BaseURL
	if value := os.Getenv("METAKIP_URL"); value != "" {
		baseURL = value
	}
	if r.cli.URL != "" {
		baseURL = r.cli.URL
	}
	return strings.TrimRight(baseURL, "/"), nil
}

func (r *runtimeState) client() (*client, error) {
	if r.clientValue != nil {
		return r.clientValue, nil
	}
	cfg, err := r.config()
	if err != nil {
		return nil, err
	}
	token := cfg.Token
	if value := os.Getenv("METAKIP_TOKEN"); value != "" {
		token = value
	}
	baseURL, err := r.serverURL()
	if err != nil {
		return nil, err
	}
	result, err := newClient(r.ctx, baseURL, token, r.cli.Timeout)
	if err != nil {
		return nil, err
	}
	r.clientValue = result
	return result, nil
}

func (r *runtimeState) interactive() bool {
	return r.stdinTTY && r.stderrTTY && !r.cli.NoInput && !r.cli.JSON
}

func (r *runtimeState) colorEnabled() bool {
	return r.stdoutTTY && !r.cli.Plain && !r.cli.JSON && !noColor()
}

func noColor() bool {
	_, present := os.LookupEnv("NO_COLOR")
	return present
}

func (r *runtimeState) style(style lipgloss.Style, value string) string {
	if !r.colorEnabled() {
		return value
	}
	return style.Render(value)
}

func (r *runtimeState) printJSON(value any) error {
	encoder := json.NewEncoder(r.stdout)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func (r *runtimeState) printError(err error) {
	code := "command_failed"
	message := err.Error()
	var details any
	var typed *cliError
	if errors.As(err, &typed) {
		code = typed.Code
		message = typed.Error()
		details = typed.Details
	}
	if r.cli.JSON {
		_ = r.printJSON(jsonErrorEnvelope{Error: jsonError{Code: code, Message: message, Details: details}})
		return
	}
	var paragraphs []string
	var detailLines []string
	if typed != nil {
		paragraphs = typed.Presentation.HumanParagraphs
		detailLines = append(detailLines, typed.Presentation.HumanDetailLines...)
	}
	fmt.Fprintln(r.stderr, terminalText(formatHumanError(message)))
	for _, paragraph := range paragraphs {
		fmt.Fprintln(r.stderr)
		fmt.Fprintln(r.stderr, terminalText(paragraph))
	}
	for _, line := range detailLines {
		fmt.Fprintln(r.stderr, terminalText(line))
	}
}

func (r *runtimeState) verifyToken(baseURL, token string) (authenticatedUser, error) {
	probe, err := newClient(r.ctx, baseURL, token, 15*time.Second)
	if err != nil {
		return authenticatedUser{}, err
	}
	response, err := probe.request(http.MethodGet, "/me", nil, nil)
	if err != nil {
		return authenticatedUser{}, err
	}
	var user authenticatedUser
	return user, decodeJSON(response, &user)
}

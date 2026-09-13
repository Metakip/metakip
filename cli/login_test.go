package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type failingReader struct {
	read bool
}

func TestLoginPreservesAuthenticationExitStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(response, `{"error":{"code":"invalid_token","message":"Invalid token"}}`)
	}))
	defer server.Close()
	t.Setenv("METAKIP_TOKEN", "invalid-token")
	cfg := config{BaseURL: server.URL}
	runtime := &runtimeState{
		ctx: context.Background(), cli: &CLI{}, stdout: io.Discard, stderr: io.Discard,
		stdin: strings.NewReader(""), configValue: &cfg,
	}

	err := (&LoginCmd{}).Run(runtime)
	if errorCode(err) != "token_validation_failed" {
		t.Fatalf("expected token_validation_failed, got %v", err)
	}
	if exitCode(err) != exitAuth {
		t.Fatalf("expected authentication exit code %d, got %d", exitAuth, exitCode(err))
	}
}

func (reader *failingReader) Read(_ []byte) (int, error) {
	reader.read = true
	return 0, io.EOF
}

func TestNonInteractiveLoginDoesNotReadTerminalInput(t *testing.T) {
	t.Setenv("METAKIP_TOKEN", "")
	for _, test := range []struct {
		name string
		cli  CLI
	}{
		{name: "no input", cli: CLI{NoInput: true}},
		{name: "json", cli: CLI{JSON: true}},
	} {
		t.Run(test.name, func(t *testing.T) {
			stdin := &failingReader{}
			cfg := config{BaseURL: "https://example.test"}
			runtime := &runtimeState{
				ctx:         context.Background(),
				cli:         &test.cli,
				stdin:       stdin,
				stdout:      io.Discard,
				stderr:      io.Discard,
				stdinTTY:    true,
				stderrTTY:   true,
				configValue: &cfg,
			}

			err := (&LoginCmd{}).Run(runtime)
			if err == nil || !strings.Contains(err.Error(), "METAKIP_TOKEN") {
				t.Fatalf("expected METAKIP_TOKEN usage error, got %v", err)
			}
			if stdin.read {
				t.Fatal("login read from terminal in non-interactive mode")
			}
		})
	}
}

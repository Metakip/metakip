package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDoctorStandaloneCheckExposesStructuredPaths(t *testing.T) {
	stateDir := t.TempDir()
	installDir := t.TempDir()
	binaryPath := filepath.Join(installDir, executableName())
	if err := os.WriteFile(binaryPath, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	receipt := installReceipt{
		SchemaVersion: 1,
		InstallMethod: standaloneInstallMethod,
		InstallDir:    installDir,
		BinaryPath:    binaryPath,
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	receiptPath := filepath.Join(stateDir, "install.json")
	if err := os.WriteFile(receiptPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)

	check := inspectStandaloneInstall()
	if check.Status != doctorStatusHealthy || check.ReceiptPath != receiptPath || check.BinaryPath != binaryPath || check.Error != "" {
		t.Fatalf("unexpected standalone check %#v", check)
	}
	if check.Message != "Installed at "+binaryPath+"." {
		t.Fatalf("compatibility message = %q", check.Message)
	}
	encoded, err := json.Marshal(check)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"status", "message", "receiptPath", "binaryPath"} {
		if _, present := fields[field]; !present {
			t.Fatalf("standalone JSON omitted %q: %s", field, encoded)
		}
	}
	if _, present := fields["operation"]; present {
		t.Fatalf("healthy standalone JSON included operation: %s", encoded)
	}
	if _, present := fields["error"]; present {
		t.Fatalf("healthy standalone JSON included error: %s", encoded)
	}
}

func TestDoctorChecksSavedAuthentication(t *testing.T) {
	t.Setenv("METAKIP_TOKEN", "")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/api/v1/me" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		fmt.Fprint(response, `{"id":"user","name":"Ada","email":"ada@example.com","authentication":"token","scopes":["pages:read"]}`)
	}))
	t.Cleanup(server.Close)
	client, err := newClient(t.Context(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		ctx:         t.Context(),
		cli:         &CLI{JSON: true, Timeout: time.Second},
		stdout:      output,
		clientValue: client,
		configValue: &config{BaseURL: server.URL, Token: "secret"},
	}
	if err := (&DoctorCmd{}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	var result doctorResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Authentication.Status != "authenticated" || result.Authentication.Source != "saved configuration" || result.Authentication.User != "ada@example.com" || tokenAccess(result.Authentication.Scopes) != "Read-only" {
		t.Fatalf("unexpected authentication result %#v", result.Authentication)
	}
}

func TestDoctorReportsMissingAuthenticationWithoutNetwork(t *testing.T) {
	t.Setenv("METAKIP_TOKEN", "")
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		ctx:         t.Context(),
		cli:         &CLI{JSON: true, Timeout: time.Second},
		stdout:      output,
		configValue: &config{BaseURL: "https://metakip.example.com"},
	}
	if err := (&DoctorCmd{}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	var result doctorResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Authentication.Status != "not_authenticated" {
		t.Fatalf("unexpected authentication result %#v", result.Authentication)
	}
}

func TestDoctorRendersIndependentChecksWhenAuthenticationFails(t *testing.T) {
	t.Setenv("METAKIP_TOKEN", "")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(response, `{"error":{"code":"not_authenticated","message":"Invalid token"}}`)
	}))
	t.Cleanup(server.Close)
	client, err := newClient(t.Context(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		ctx:         t.Context(),
		cli:         &CLI{JSON: true, Timeout: time.Second},
		stdout:      output,
		clientValue: client,
		configValue: &config{BaseURL: server.URL, Token: "secret"},
	}
	err = (&DoctorCmd{}).Run(runtime)
	if errorCode(err) != "doctor_unhealthy" {
		t.Fatalf("expected unhealthy doctor result, got %v", err)
	}
	var result doctorResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Authentication.Status != "unhealthy" || result.Standalone.Status == "" || result.Skills.Status == "" {
		t.Fatalf("missing diagnostics %#v", result)
	}
	before := output.String()
	if code := reportRunError(runtime, err); code != exitFailure {
		t.Fatalf("doctor failure exit code = %d, want %d", code, exitFailure)
	}
	if output.String() != before {
		t.Fatalf("doctor failure rendered duplicate output: %q", output.String()[len(before):])
	}
}

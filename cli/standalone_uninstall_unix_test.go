//go:build !windows

package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestPurgePreservesShellProfile(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	if err := os.Mkdir(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	installDir := filepath.Join(t.TempDir(), "metakip")
	if err := os.Mkdir(installDir, 0o700); err != nil {
		t.Fatal(err)
	}
	binaryPath := filepath.Join(installDir, executableName())
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(executable, binaryPath); err != nil {
		t.Fatal(err)
	}
	profilePath := filepath.Join(t.TempDir(), "profile")
	profile := []byte("before\n# >>> metakip >>>\nexport PATH=\"" + installDir + ":$PATH\"\n# <<< metakip <<<\nafter\n")
	if err := os.WriteFile(profilePath, profile, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)
	t.Setenv("METAKIP_CONFIG_DIR", t.TempDir())
	if err := writeStandaloneReceipt(filepath.Join(stateDir, "install.json"), installReceipt{
		SchemaVersion: 1,
		InstallMethod: standaloneInstallMethod,
		InstallDir:    installDir,
		BinaryPath:    binaryPath,
		PathFile:      profilePath,
	}); err != nil {
		t.Fatal(err)
	}
	if err := (&UninstallCmd{Purge: true, Yes: true}).Run(&runtimeState{ctx: context.Background(), cli: &CLI{}, stdout: io.Discard}); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(profilePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(profile) {
		t.Fatalf("purge changed shell profile: %q", actual)
	}
}

func TestRemoveStandaloneBinaryRestoresReceiptWhenBinaryRemovalFails(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	if err := os.Mkdir(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	receiptPath := filepath.Join(stateDir, "install.json")
	receipt := []byte("receipt")
	if err := os.WriteFile(receiptPath, receipt, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(receiptPath, 0o640); err != nil {
		t.Fatal(err)
	}
	binaryPath := filepath.Join(t.TempDir(), "metakip")
	if err := os.Mkdir(binaryPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binaryPath, "child"), []byte("prevent removal"), 0o600); err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", configDir)
	configPath := filepath.Join(configDir, "config.json")
	config := []byte(`{"baseUrl":"https://app.metakip.com","token":"secret"}`)
	if err := os.WriteFile(configPath, config, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := removeStandaloneBinary(binaryPath, receiptPath, configPath); err == nil {
		t.Fatalf("expected binary removal error, got %v", err)
	}
	actualReceipt, err := os.ReadFile(receiptPath)
	if err != nil {
		t.Fatalf("receipt was not restored: %v", err)
	}
	if string(actualReceipt) != string(receipt) {
		t.Fatalf("restored receipt = %q", actualReceipt)
	}
	info, err := os.Stat(receiptPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("restored receipt mode = %o", info.Mode().Perm())
	}
	stateInfo, err := os.Stat(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if stateInfo.Mode().Perm() != 0o700 {
		t.Fatalf("restored state directory mode = %o", stateInfo.Mode().Perm())
	}
	if _, err := os.Stat(binaryPath); err != nil {
		t.Fatalf("binary was unexpectedly removed: %v", err)
	}
	actualConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("purge config was removed after failed uninstall: %v", err)
	}
	if string(actualConfig) != string(config) {
		t.Fatalf("purge config changed after failed uninstall: %q", actualConfig)
	}
}

func TestRemoveStandaloneBinaryPreservesManagedStateWhenPurgeConfigFails(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	if err := os.Mkdir(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	receiptPath := filepath.Join(stateDir, "install.json")
	if err := os.WriteFile(receiptPath, []byte("receipt"), 0o600); err != nil {
		t.Fatal(err)
	}
	binaryPath := filepath.Join(t.TempDir(), "metakip")
	if err := os.WriteFile(binaryPath, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.Mkdir(configPath, 0o700); err != nil {
		t.Fatal(err)
	}

	if _, err := removeStandaloneBinary(binaryPath, receiptPath, configPath); err == nil {
		t.Fatalf("expected config cleanup failure, got %v", err)
	}
	if _, err := os.Stat(binaryPath); err != nil {
		t.Fatalf("binary was removed after failed purge: %v", err)
	}
	if _, err := os.Stat(receiptPath); err != nil {
		t.Fatalf("receipt was removed after failed purge: %v", err)
	}
	if err := os.Remove(configPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte("config"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := removeStandaloneBinary(binaryPath, receiptPath, configPath); err != nil {
		t.Fatalf("retry after config cleanup failure: %v", err)
	}
	if _, err := os.Stat(binaryPath); !os.IsNotExist(err) {
		t.Fatalf("binary remains after retry: %v", err)
	}
	if _, err := os.Stat(receiptPath); !os.IsNotExist(err) {
		t.Fatalf("receipt remains after retry: %v", err)
	}
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Fatalf("config remains after retry: %v", err)
	}
}

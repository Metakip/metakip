package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUnmanagedUpdateErrorKeepsCanonicalMessage(t *testing.T) {
	err := unmanagedUpdateError()
	want := "Cannot update this binary because it is not managed by the standalone installer."
	if err.Error() != want {
		t.Fatalf("unmanaged update error = %q, want %q", err.Error(), want)
	}
}

func TestNewUpdateProgressDisablesPlainOutput(t *testing.T) {
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		cli:       &CLI{Plain: true},
		stderr:    output,
		stderrTTY: true,
	}
	progress := newUpdateProgress(runtime)
	progress.phase("Checking for updates...")
	progress.phase("Downloading metakip.tar.gz...")
	if output.Len() != 0 {
		t.Fatalf("plain progress output = %q", output.String())
	}
}

func TestLoadInstallReceiptRejectsUnknownFields(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_INSTALL_STATE_DIR", dir)
	receipt := `{
  "schemaVersion": 1,
  "installMethod": "standalone",
  "installDir": "/tmp/metakip",
  "binaryPath": "/tmp/metakip/metakip",
  "unexpected": true
}`
	if err := os.WriteFile(filepath.Join(dir, "install.json"), []byte(receipt), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadInstallReceipt(); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown field error, got %v", err)
	}
}
func TestValidateInstallReceiptRejectsBinaryOutsideInstallDirectory(t *testing.T) {
	installDir := filepath.Join(t.TempDir(), "metakip")
	err := validateInstallReceipt(installReceipt{
		SchemaVersion: 1,
		InstallMethod: standaloneInstallMethod,
		InstallDir:    installDir,
		BinaryPath:    filepath.Join(t.TempDir(), "other", executableName()),
	})
	if err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("expected out-of-directory receipt error, got %v", err)
	}
}

func TestValidateInstallReceiptRejectsRelativePathFile(t *testing.T) {
	installDir := filepath.Join(t.TempDir(), "metakip")
	err := validateInstallReceipt(installReceipt{
		SchemaVersion: 1,
		InstallMethod: standaloneInstallMethod,
		InstallDir:    installDir,
		BinaryPath:    filepath.Join(installDir, executableName()),
		PathFile:      "relative-profile",
	})
	if err == nil || !strings.Contains(err.Error(), "PATH file") {
		t.Fatalf("expected relative PATH file error, got %v", err)
	}
}

func TestLoadInstallReceiptRestoresInterruptedUninstallBackup(t *testing.T) {
	stateDir := t.TempDir()
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)
	installDir := filepath.Join(t.TempDir(), "metakip")
	if err := os.Mkdir(installDir, 0o700); err != nil {
		t.Fatal(err)
	}
	receipt := installReceipt{
		SchemaVersion: 1,
		InstallMethod: standaloneInstallMethod,
		InstallDir:    installDir,
		BinaryPath:    filepath.Join(installDir, executableName()),
	}
	if err := os.WriteFile(receipt.BinaryPath, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	backupPath := filepath.Join(stateDir, "install.json.uninstall-backup")
	if err := os.WriteFile(backupPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, path, err := loadInstallReceipt()
	if err != nil {
		t.Fatal(err)
	}
	if loaded != receipt {
		t.Fatalf("recovered receipt = %#v", loaded)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("receipt was not restored: %v", err)
	}
	if _, err := os.Stat(backupPath); !os.IsNotExist(err) {
		t.Fatalf("receipt backup still exists or could not be checked: %v", err)
	}
}

func TestLoadInstallReceiptDoesNotRestoreBackupAfterCompletedUninstall(t *testing.T) {
	stateDir := t.TempDir()
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)
	installDir := filepath.Join(t.TempDir(), "removed")
	receipt := installReceipt{SchemaVersion: 1, InstallMethod: standaloneInstallMethod, InstallDir: installDir, BinaryPath: filepath.Join(installDir, executableName())}
	data, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	backupPath := filepath.Join(stateDir, "install.json.uninstall-backup")
	if err := os.WriteFile(backupPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadInstallReceipt(); errorCode(err) != "unmanaged_install" {
		t.Fatalf("expected unmanaged install, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "install.json")); !os.IsNotExist(err) {
		t.Fatalf("stale receipt backup was restored: %v", err)
	}
}

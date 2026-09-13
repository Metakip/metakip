//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestStandaloneUninstallHelperRestoresReceiptWhenBinaryRemovalFails(t *testing.T) {
	stateDir := t.TempDir()
	installDir := filepath.Join(stateDir, "Metakip")
	if err := os.Mkdir(installDir, 0o700); err != nil {
		t.Fatal(err)
	}
	binaryPath := filepath.Join(installDir, "metakip.exe")
	if err := os.Mkdir(binaryPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binaryPath, "child"), []byte("prevent removal"), 0o600); err != nil {
		t.Fatal(err)
	}
	receiptPath := filepath.Join(stateDir, "install.json")
	receipt, err := json.Marshal(installReceipt{SchemaVersion: 1, InstallMethod: standaloneInstallMethod, InstallDir: installDir, BinaryPath: binaryPath})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(receiptPath, receipt, 0o600); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(stateDir, "config.json")
	config := []byte(`{"baseUrl":"https://app.metakip.com","token":"secret"}`)
	if err := os.WriteFile(configPath, config, 0o600); err != nil {
		t.Fatal(err)
	}
	failurePath := filepath.Join(stateDir, "uninstall-failure.txt")
	helperPath := filepath.Join(stateDir, "uninstall-test.ps1")
	if err := os.WriteFile(helperPath, []byte(standaloneUninstallScript(0, binaryPath, receiptPath, configPath, failurePath)), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath)
	if output, err := command.CombinedOutput(); err == nil {
		t.Fatalf("uninstall helper unexpectedly succeeded: %s", output)
	}
	actualReceipt, err := os.ReadFile(receiptPath)
	if err != nil {
		t.Fatalf("receipt was not restored: %v", err)
	}
	if string(actualReceipt) != string(receipt) {
		t.Fatalf("restored receipt = %q", actualReceipt)
	}
	actualConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("purge config was removed after failed uninstall: %v", err)
	}
	if string(actualConfig) != string(config) {
		t.Fatalf("purge config changed after failed uninstall: %q", actualConfig)
	}
	if _, err := os.Stat(failurePath); err != nil {
		t.Fatalf("uninstall helper did not record its failure: %v", err)
	}
}

func TestStandaloneUninstallHelperRemovesBinaryAndReceipt(t *testing.T) {
	stateDir := t.TempDir()
	installDir := filepath.Join(stateDir, "Metakip")
	if err := os.Mkdir(installDir, 0o700); err != nil {
		t.Fatal(err)
	}
	binaryPath := filepath.Join(installDir, "metakip.exe")
	if err := os.WriteFile(binaryPath, []byte("binary"), 0o600); err != nil {
		t.Fatal(err)
	}
	receiptPath := filepath.Join(stateDir, "install.json")
	receipt, err := json.Marshal(installReceipt{SchemaVersion: 1, InstallMethod: standaloneInstallMethod, InstallDir: installDir, BinaryPath: binaryPath})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(receiptPath, receipt, 0o600); err != nil {
		t.Fatal(err)
	}
	helperPath := filepath.Join(stateDir, "uninstall-success.ps1")
	if err := os.WriteFile(helperPath, []byte(standaloneUninstallScript(0, binaryPath, receiptPath, "", filepath.Join(stateDir, "failure"))), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("run uninstall helper: %v\n%s", err, output)
	}
	if _, err := os.Stat(binaryPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("binary still exists: %v", err)
	}
	if _, err := os.Stat(receiptPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("receipt still exists: %v", err)
	}
}

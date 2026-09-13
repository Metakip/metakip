//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestStandaloneUpdateHelperReplacesBinary(t *testing.T) {
	directory := t.TempDir()
	destination := filepath.Join(directory, "metakip.exe")
	staged := filepath.Join(directory, "metakip-staged.exe")
	failurePath := filepath.Join(directory, "update-failure.txt")
	if err := os.WriteFile(destination, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(staged, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	runStandaloneUpdateHelper(t, standaloneUpdateScript(0, destination, staged, failurePath), directory, false)
	contents, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new" {
		t.Fatalf("updated binary = %q", contents)
	}
	if _, err := os.Stat(staged); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staged binary still exists or could not be checked: %v", err)
	}
	if _, err := os.Stat(failurePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("update helper recorded a failure: %v", err)
	}
}

func TestStandaloneUpdateHelperPersistsFailure(t *testing.T) {
	directory := t.TempDir()
	destination := filepath.Join(directory, "metakip.exe")
	staged := filepath.Join(directory, "missing-staged.exe")
	failurePath := filepath.Join(directory, "update-failure.txt")
	if err := os.WriteFile(destination, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	runStandaloneUpdateHelper(t, standaloneUpdateScript(0, destination, staged, failurePath), directory, true)
	failure, err := os.ReadFile(failurePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(failure), "deferred_update_failed") {
		t.Fatalf("unexpected deferred failure: %q", failure)
	}
	contents, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "old" {
		t.Fatalf("failed update changed the binary: %q", contents)
	}
}

func runStandaloneUpdateHelper(t *testing.T, script, directory string, wantFailure bool) {
	t.Helper()
	helper := filepath.Join(directory, "update-test.ps1")
	if err := os.WriteFile(helper, []byte(script), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper)
	output, err := command.CombinedOutput()
	if wantFailure && err == nil {
		t.Fatalf("update helper unexpectedly succeeded: %s", output)
	}
	if !wantFailure && err != nil {
		t.Fatalf("run update helper: %v\n%s", err, output)
	}
}

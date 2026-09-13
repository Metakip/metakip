//go:build windows

package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func testEditorCommand(t *testing.T) string {
	t.Helper()
	editor := filepath.Join(t.TempDir(), "editor.cmd")
	if err := os.WriteFile(editor, []byte("@echo off\r\n<nul set /p \"=Edited\" > \"%~1\"\r\nexit /b 0\r\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	return `"` + editor + `"`
}

func TestParseEditorCommandPreservesWindowsPath(t *testing.T) {
	command := `"C:\Program Files\Metakip\editor.exe" --wait`
	got, err := parseEditorCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{`C:\Program Files\Metakip\editor.exe`, "--wait"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseEditorCommand(%q) = %#v, want %#v", command, got, want)
	}
}

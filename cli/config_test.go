package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestConfigRoundTripUsesRestrictedPermissions(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", dir)
	want := config{BaseURL: "https://example.test", Token: "mdn_secret"}
	if err := saveConfig(want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); runtime.GOOS != "windows" && got != 0o600 {
		t.Fatalf("config permissions = %o", got)
	}
	got, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("config = %#v, want %#v", got, want)
	}
	if err := removeConfig(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.json")); !os.IsNotExist(err) {
		t.Fatalf("config still exists: %v", err)
	}
}

func TestSaveConfigRestrictsExistingFileBeforeReplacingToken(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", dir)
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"baseUrl":"https://example.test","token":"old"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}

	want := config{BaseURL: "https://example.test", Token: "new-secret"}
	if err := saveConfig(want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); runtime.GOOS != "windows" && got != 0o600 {
		t.Fatalf("config permissions = %o", got)
	}
	got, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("config = %#v, want %#v", got, want)
	}
}

func TestLoadConfigRejectsInvalidUTF8(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte{0x7b, 0x22, 0xff, 0x22, 0x7d}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected invalid UTF-8 config to fail")
	}
}

func TestLoadConfigDefaultsToMetakipCloud(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", dir)
	config, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.BaseURL != "https://app.metakip.com" {
		t.Fatalf("default base URL = %q", config.BaseURL)
	}
}

func TestLoadConfigMigratesLegacyHostedURL(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", dir)
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"baseUrl":"https://app.markdawn.space/","token":"secret"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got.BaseURL != defaultBaseURL {
		t.Fatalf("migrated base URL = %q", got.BaseURL)
	}

	migrated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(migrated), `"baseUrl": "`+defaultBaseURL+`"`) {
		t.Fatalf("config was not migrated: %s", migrated)
	}
}

func TestLoadConfigRejectsUnknownFieldsAndMultipleValues(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("METAKIP_CONFIG_DIR", dir)
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"baseUrl":"https://example.test","token":"secret","unknown":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadConfig(); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown field error, got %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"baseUrl":"https://example.test","token":"secret"} {}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadConfig(); err == nil || !strings.Contains(err.Error(), "multiple JSON values") {
		t.Fatalf("expected multiple JSON values error, got %v", err)
	}
}

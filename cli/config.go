package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const defaultBaseURL = "https://app.metakip.com"
const legacyHostedBaseURL = "https://app.markdawn.space"

type config struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

func configPath() (string, error) {
	if dir := os.Getenv("METAKIP_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "config.json"), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "metakip", "config.json"), nil
}

func loadConfig() (config, error) {
	result := config{BaseURL: defaultBaseURL}
	path, err := configPath()
	if err != nil {
		return result, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if !utf8.Valid(data) {
		return result, fmt.Errorf("read config: invalid UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, fmt.Errorf("read config: %w", err)
	}
	var trailing struct{}
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return result, fmt.Errorf("read config: multiple JSON values")
		}
		return result, fmt.Errorf("read config: %w", err)
	}
	if result.BaseURL == "" {
		result.BaseURL = defaultBaseURL
	}
	result.BaseURL = strings.TrimRight(result.BaseURL, "/")
	if result.BaseURL == legacyHostedBaseURL {
		result.BaseURL = defaultBaseURL
		if err := saveConfig(result); err != nil {
			return result, fmt.Errorf("migrate config: %w", err)
		}
	}
	return result, nil
}

func saveConfig(value config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	// Restrict an existing config before replacement so its old token is not
	// exposed while the new private temporary file is prepared.
	if err := os.Chmod(path, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return writePrivateFileAtomically(path, append(data, '\n'))
}

func removeConfig() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

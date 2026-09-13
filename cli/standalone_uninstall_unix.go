//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func removeStandaloneBinary(binaryPath, receiptPath, configPath string) (bool, error) {
	stateDir := filepath.Dir(receiptPath)
	stateInfo, err := os.Stat(stateDir)
	if err != nil {
		return false, fmt.Errorf("stat standalone install state directory before removal: %w", err)
	}
	receipt, err := os.ReadFile(receiptPath)
	if err != nil {
		return false, fmt.Errorf("read standalone install receipt before removal: %w", err)
	}
	receiptInfo, err := os.Stat(receiptPath)
	if err != nil {
		return false, fmt.Errorf("stat standalone install receipt before removal: %w", err)
	}
	config, err := backupStandaloneConfig(configPath)
	if err != nil {
		return false, err
	}
	if err := removeStandaloneConfig(configPath); err != nil {
		if restoreErr := restoreStandaloneConfig(config); restoreErr != nil {
			return false, fmt.Errorf("remove Metakip configuration: %w; restore Metakip configuration: %v", err, restoreErr)
		}
		return false, err
	}
	if err := os.Remove(receiptPath); err != nil {
		if restoreErr := restoreStandaloneConfig(config); restoreErr != nil {
			return false, fmt.Errorf("remove standalone install receipt: %w; restore Metakip configuration: %v", err, restoreErr)
		}
		return false, fmt.Errorf("remove standalone install receipt: %w", err)
	}
	if err := os.Remove(stateDir); err != nil && !errors.Is(err, syscall.ENOTEMPTY) {
		if restoreErr := restoreStandaloneUninstallState(receiptPath, receipt, receiptInfo.Mode(), stateInfo.Mode(), config); restoreErr != nil {
			return false, fmt.Errorf("remove standalone install state directory: %w; %v", err, restoreErr)
		}
		return false, fmt.Errorf("remove standalone install state directory: %w", err)
	}
	if err := os.Remove(binaryPath); err != nil {
		if restoreErr := restoreStandaloneUninstallState(receiptPath, receipt, receiptInfo.Mode(), stateInfo.Mode(), config); restoreErr != nil {
			return false, fmt.Errorf("remove standalone binary: %w; %v", err, restoreErr)
		}
		return false, fmt.Errorf("remove standalone binary: %w", err)
	}
	return false, nil
}

type standaloneConfigBackup struct {
	path          string
	contents      []byte
	mode          os.FileMode
	directoryMode os.FileMode
}

func backupStandaloneConfig(path string) (*standaloneConfigBackup, error) {
	if path == "" {
		return nil, nil
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("stat Metakip configuration before removal: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("stat Metakip configuration before removal: not a regular file")
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read Metakip configuration before removal: %w", err)
	}
	directoryInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		return nil, fmt.Errorf("stat Metakip configuration directory before removal: %w", err)
	}
	return &standaloneConfigBackup{path: path, contents: contents, mode: info.Mode(), directoryMode: directoryInfo.Mode()}, nil
}

func restoreStandaloneUninstallState(receiptPath string, receipt []byte, receiptMode, stateMode os.FileMode, config *standaloneConfigBackup) error {
	if err := restoreStandaloneReceipt(receiptPath, receipt, receiptMode, stateMode); err != nil {
		return fmt.Errorf("restore standalone install receipt: %w", err)
	}
	if err := restoreStandaloneConfig(config); err != nil {
		return fmt.Errorf("restore Metakip configuration: %w", err)
	}
	return nil
}

func restoreStandaloneConfig(config *standaloneConfigBackup) error {
	if config == nil {
		return nil
	}
	directory := filepath.Dir(config.path)
	if err := os.MkdirAll(directory, config.directoryMode.Perm()); err != nil {
		return err
	}
	if err := os.Chmod(directory, config.directoryMode.Perm()); err != nil {
		return err
	}
	if err := os.WriteFile(config.path, config.contents, config.mode.Perm()); err != nil {
		return err
	}
	return os.Chmod(config.path, config.mode.Perm())
}

func restoreStandaloneReceipt(path string, contents []byte, mode, directoryMode os.FileMode) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, directoryMode.Perm()); err != nil {
		return err
	}
	if err := os.Chmod(directory, directoryMode.Perm()); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".install-restore-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode.Perm()); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(contents); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func syscallENOTEMPTY() error {
	return syscall.ENOTEMPTY
}

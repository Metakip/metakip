package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func (cmd *StandaloneFinalizeCmd) Run(_ *runtimeState) (resultErr error) {
	installDir, err := filepath.Abs(cmd.InstallDir)
	if err != nil {
		return fmt.Errorf("resolve installation directory: %w", err)
	}
	stateDir, err := installStateDir()
	if err != nil {
		return err
	}
	stateDir, err = filepath.Abs(stateDir)
	if err != nil {
		return fmt.Errorf("resolve standalone install state directory: %w", err)
	}
	receiptPath := filepath.Join(stateDir, "install.json")
	_, err = readExistingInstallReceipt(receiptPath, installDir)
	if err != nil {
		return err
	}
	if cmd.PathFile != "" && cmd.PathStyle == "" {
		return fmt.Errorf("PATH style is required when a PATH file is supplied")
	}
	if cmd.PathStyle != "" && cmd.PathFile == "" {
		return fmt.Errorf("PATH file is required when a PATH style is supplied")
	}
	if cmd.PathStyle != "" && cmd.PathStyle != "sh" && cmd.PathStyle != "fish" && cmd.PathStyle != "powershell" {
		return fmt.Errorf("unsupported PATH style: %s", cmd.PathStyle)
	}
	pathFileOption := cmd.PathFile
	if pathFileOption != "" {
		pathFileOption, err = filepath.Abs(pathFileOption)
		if err != nil {
			return fmt.Errorf("resolve installer PATH file: %w", err)
		}
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return fmt.Errorf("create standalone install state directory: %w", err)
	}
	if err := os.Chmod(stateDir, 0o700); err != nil {
		return fmt.Errorf("secure standalone install state directory: %w", err)
	}
	if info, err := os.Stat(installDir); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(installDir, 0o700); err != nil {
			return fmt.Errorf("create installation directory: %w", err)
		}
		if err := os.Chmod(installDir, 0o700); err != nil {
			return fmt.Errorf("secure installation directory: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("inspect installation directory: %w", err)
	} else if !info.IsDir() {
		return fmt.Errorf("installation directory is not a directory")
	}

	source, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate staged standalone executable: %w", err)
	}
	staged, err := copyStandaloneBinary(source, installDir)
	if err != nil {
		return err
	}
	defer os.Remove(staged)

	restorePaths := []func() error{}
	committed := false
	defer func() {
		if committed {
			return
		}
		var restoreErrs []error
		for index := len(restorePaths) - 1; index >= 0; index-- {
			if err := restorePaths[index](); err != nil {
				restoreErrs = append(restoreErrs, err)
			}
		}
		if len(restoreErrs) == 0 {
			return
		}
		restoreErr := errors.Join(restoreErrs...)
		if resultErr == nil {
			resultErr = fmt.Errorf("restore installer PATH blocks: %w", restoreErr)
		} else {
			resultErr = fmt.Errorf("%w; restore installer PATH blocks: %v", resultErr, restoreErr)
		}
	}()
	if pathFileOption != "" {
		var restoreCurrentPath func() error
		_, restoreCurrentPath, err = addStandalonePathBlock(pathFileOption, installDir, cmd.PathStyle)
		if err != nil {
			return err
		}
		restorePaths = append(restorePaths, restoreCurrentPath)
	}

	binaryPath := filepath.Join(installDir, executableName())
	binaryBackup, err := replaceStandaloneBinary(staged, binaryPath)
	if err != nil {
		return err
	}
	if binaryBackup != "" {
		defer func() {
			if committed {
				_ = os.Remove(binaryBackup)
			}
		}()
	}
	receipt := installReceipt{SchemaVersion: 1, InstallMethod: standaloneInstallMethod, InstallDir: installDir, BinaryPath: binaryPath}
	if err := writeStandaloneReceipt(receiptPath, receipt); err != nil {
		var restoreErr error
		if binaryBackup != "" {
			restoreErr = os.Rename(binaryBackup, binaryPath)
		} else {
			restoreErr = os.Remove(binaryPath)
		}
		if restoreErr != nil {
			return fmt.Errorf("publish standalone install receipt: %w; restore standalone binary: %v", err, restoreErr)
		}
		return err
	}
	committed = true
	return nil
}

func readExistingInstallReceipt(path, installDir string) (installReceipt, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return installReceipt{}, nil
	}
	if err != nil {
		return installReceipt{}, fmt.Errorf("read standalone install receipt: %w", err)
	}
	receipt, err := decodeInstallReceipt(data)
	if err != nil {
		return installReceipt{}, fmt.Errorf("read standalone install receipt: %w", err)
	}
	if filepath.Clean(receipt.InstallDir) != filepath.Clean(installDir) {
		return installReceipt{}, fmt.Errorf("a standalone Metakip installation is already managed at %s; uninstall it before changing the installation directory", receipt.InstallDir)
	}
	return receipt, nil
}

func copyStandaloneBinary(source, installDir string) (string, error) {
	input, err := os.Open(source)
	if err != nil {
		return "", fmt.Errorf("open staged standalone executable: %w", err)
	}
	defer input.Close()
	output, err := os.CreateTemp(installDir, ".metakip-*")
	if err != nil {
		return "", fmt.Errorf("create staged standalone executable: %w", err)
	}
	path := output.Name()
	if err := output.Chmod(0o755); err != nil {
		output.Close()
		os.Remove(path)
		return "", err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		os.Remove(path)
		return "", err
	}
	if err := output.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

func replaceStandaloneBinary(staged, destination string) (string, error) {
	backup := ""
	if info, err := os.Lstat(destination); err == nil {
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("standalone binary destination is not a regular file")
		}
		temporary, err := os.CreateTemp(filepath.Dir(destination), "."+filepath.Base(destination)+".backup-*")
		if err != nil {
			return "", err
		}
		backup = temporary.Name()
		if err := temporary.Close(); err != nil {
			os.Remove(backup)
			return "", err
		}
		if err := os.Remove(backup); err != nil {
			return "", err
		}
		if err := os.Rename(destination, backup); err != nil {
			return "", err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(staged, destination); err != nil {
		if backup != "" {
			if restoreErr := os.Rename(backup, destination); restoreErr != nil {
				return "", fmt.Errorf("replace standalone binary: %w; restore previous binary: %v", err, restoreErr)
			}
		}
		return "", err
	}
	return backup, nil
}

func writeStandaloneReceipt(path string, receipt installReceipt) error {
	data, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFileAtomically(path, append(data, '\n'))
}

func addStandalonePathBlock(path, installDir, style string) (string, func() error, error) {
	resolved := path
	original, err := os.ReadFile(path)
	created := errors.Is(err, os.ErrNotExist)
	if created {
		original = nil
	} else if err != nil {
		return "", nil, fmt.Errorf("read installer PATH file: %w", err)
	} else {
		resolved, err = filepath.EvalSymlinks(path)
		if err != nil {
			return "", nil, fmt.Errorf("resolve installer PATH file: %w", err)
		}
	}
	contents, encoding, err := decodeProfile(original)
	if err != nil {
		return "", nil, fmt.Errorf("read installer PATH file: %w", err)
	}
	_, _, found, err := managedPathBlockRange(contents, installDir)
	if err != nil {
		return "", nil, fmt.Errorf("read installer PATH file: %w", err)
	}
	if found {
		return path, func() error { return nil }, nil
	}
	entry := standalonePathEntry(installDir, style)
	updated := contents + "\n" + pathBlockStart + "\n" + entry + "\n" + pathBlockEnd + "\n"
	encoded, err := encodeProfile(updated, encoding)
	if err != nil {
		return "", nil, err
	}
	if created {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return "", nil, err
		}
		if err := writePrivateFileAtomically(path, encoded); err != nil {
			return "", nil, err
		}
	} else if err := writeStandalonePathProfile(resolved, encoded); err != nil {
		return "", nil, err
	}
	return path, func() error {
		if created {
			return os.Remove(path)
		}
		return writeStandalonePathProfile(resolved, original)
	}, nil
}

func standalonePathEntry(installDir, style string) string {
	if style == "fish" {
		return "fish_add_path -- " + quoteFishShell(installDir)
	}
	if style == "powershell" {
		return "$env:Path = '" + strings.ReplaceAll(installDir, "'", "''") + "' + [IO.Path]::PathSeparator + $env:Path"
	}
	return "export PATH=" + quotePOSIXShell(installDir) + ":$PATH"
}

func quotePOSIXShell(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func quoteFishShell(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "\\'") + "'"
}

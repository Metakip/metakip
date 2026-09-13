//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func removeStandaloneBinary(binaryPath, receiptPath, configPath string) (bool, error) {
	stateDir := filepath.Dir(receiptPath)
	failurePath := filepath.Join(stateDir, "uninstall-failure.txt")
	if failure, err := os.ReadFile(failurePath); err == nil {
		if err := os.Remove(failurePath); err != nil {
			return false, fmt.Errorf("clear deferred uninstall failure: %w", err)
		}
		return false, &cliError{Code: "deferred_uninstall_failed", Message: "Previous deferred uninstall failed", Cause: errors.New(string(failure))}
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("read deferred uninstall failure: %w", err)
	}
	helperPath := filepath.Join(stateDir, fmt.Sprintf("uninstall-%d.ps1", os.Getpid()))
	script := standaloneUninstallScript(os.Getpid(), binaryPath, receiptPath, configPath, failurePath)
	if err := os.WriteFile(helperPath, []byte(script), 0o600); err != nil {
		return false, fmt.Errorf("write uninstall helper: %w", err)
	}
	command := powershellCommand("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", helperPath)
	if err := command.Start(); err != nil {
		return false, fmt.Errorf("start uninstall helper: %w", err)
	}
	return true, nil
}

func standaloneUninstallScript(parentID int, binaryPath, receiptPath, configPath, failurePath string) string {
	receiptBackupPath := receiptPath + ".uninstall-backup"
	return fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$failed = $false
$configChanged = $false
try {
$parent = %d
$binaryPath = '%s'
$receiptPath = '%s'
$receiptBackup = '%s'
$configPath = '%s'
if ($parent -gt 0) {
  Wait-Process -Id $parent -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath $receiptPath -Destination $receiptBackup -Force -ErrorAction Stop
if ($configPath -ne '' -and (Test-Path -LiteralPath $configPath)) {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Metakip configuration is not a regular file' }
  $configBytes = [IO.File]::ReadAllBytes($configPath)
  $configAttributes = [IO.File]::GetAttributes($configPath)
  $configAcl = Get-Acl -LiteralPath $configPath
  Remove-Item -LiteralPath $configPath -Force -ErrorAction Stop
  $configChanged = $true
}
Remove-Item -LiteralPath $receiptPath -Force -ErrorAction Stop
Remove-Item -LiteralPath $binaryPath -Force -ErrorAction Stop
Remove-Item -LiteralPath $receiptBackup -Force -ErrorAction SilentlyContinue
} catch {
$failed = $true
$failureMessage = $_.Exception.Message
if ($configChanged) {
  try {
    [IO.File]::WriteAllBytes($configPath, $configBytes)
    Set-Acl -LiteralPath $configPath -AclObject $configAcl
    [IO.File]::SetAttributes($configPath, $configAttributes)
  } catch {
    $failureMessage += [Environment]::NewLine + 'restore Metakip configuration: ' + $_.Exception.Message
  }
}
if (Test-Path -LiteralPath $receiptBackup -PathType Leaf) {
  try {
    Move-Item -LiteralPath $receiptBackup -Destination $receiptPath -Force -ErrorAction Stop
  } catch {
    $failureMessage += [Environment]::NewLine + 'restore install receipt: ' + $_.Exception.Message
  }
}
[IO.File]::WriteAllText('%s', "deferred_uninstall_failed" + [Environment]::NewLine + $failureMessage, (New-Object Text.UTF8Encoding($false)))
} finally {
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
`, parentID, powershellLiteral(binaryPath), powershellLiteral(receiptPath), powershellLiteral(receiptBackupPath), powershellLiteral(configPath), powershellLiteral(failurePath))
}

func syscallENOTEMPTY() error {
	return nil
}

func powershellLiteral(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

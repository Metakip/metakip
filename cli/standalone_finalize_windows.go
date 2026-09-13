//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func writeStandalonePathProfile(path string, contents []byte) error {
	contentsFile, err := os.CreateTemp(filepath.Dir(path), ".metakip-profile-contents-*")
	if err != nil {
		return fmt.Errorf("stage PowerShell profile contents: %w", err)
	}
	contentsPath := contentsFile.Name()
	defer os.Remove(contentsPath)
	if err := contentsFile.Chmod(0o600); err != nil {
		contentsFile.Close()
		return fmt.Errorf("secure staged PowerShell profile contents: %w", err)
	}
	if _, err := contentsFile.Write(contents); err != nil {
		contentsFile.Close()
		return fmt.Errorf("write staged PowerShell profile contents: %w", err)
	}
	if err := contentsFile.Close(); err != nil {
		return fmt.Errorf("close staged PowerShell profile contents: %w", err)
	}
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$path = '%s'
$contents = [IO.File]::ReadAllBytes('%s')
$attributes = [IO.File]::GetAttributes($path)
$acl = Get-Acl -LiteralPath $path
$temporary = Join-Path (Split-Path -Parent $path) ('.metakip-profile-' + [Guid]::NewGuid().ToString('N'))
try {
  [IO.File]::WriteAllBytes($temporary, $contents)
  Set-Acl -LiteralPath $temporary -AclObject $acl
  [IO.File]::SetAttributes($temporary, $attributes)
  Move-Item -LiteralPath $temporary -Destination $path -Force -ErrorAction Stop
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
`, powershellLiteral(path), powershellLiteral(contentsPath))
	output, err := powershellCommand("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("replace PowerShell profile: %w: %s", err, output)
	}
	return nil
}

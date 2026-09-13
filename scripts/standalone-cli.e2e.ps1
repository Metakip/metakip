$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('metakip-cli-e2e-' + [Guid]::NewGuid().ToString('N'))

try {
  $installDir = Join-Path $testRoot 'install'
  $stateDir = Join-Path $testRoot 'state'
  $configDir = Join-Path $testRoot 'config'
  $profilePath = Join-Path $testRoot 'Microsoft.PowerShell_profile.ps1'
  New-Item -ItemType Directory -Force -Path $installDir, $stateDir, $configDir | Out-Null
  $binaryPath = Join-Path $installDir 'metakip.exe'
  & go -C (Join-Path $repositoryRoot 'cli') build -trimpath -o $binaryPath .
  if ($LASTEXITCODE -ne 0) { throw 'could not build CLI for standalone E2E test' }

  $entry = "`$env:Path = '$($installDir.Replace("'", "''"))' + [IO.Path]::PathSeparator + `$env:Path"
  [IO.File]::WriteAllText($profilePath, "before`r`n# >>> metakip >>>`r`n$entry`r`n# <<< metakip <<<`r`nafter`r`n", [Text.UTF8Encoding]::new($false))
  $profileBefore = [IO.File]::ReadAllText($profilePath)
  [IO.File]::WriteAllText((Join-Path $configDir 'config.json'), '{"baseUrl":"https://app.metakip.com","token":"secret"}', [Text.UTF8Encoding]::new($false))
  $receipt = [PSCustomObject]@{
    schemaVersion = 1
    installMethod = 'standalone'
    installDir = $installDir
    binaryPath = $binaryPath
    pathFile = $profilePath
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $stateDir 'install.json'), $receipt, [Text.UTF8Encoding]::new($false))

  $env:METAKIP_INSTALL_STATE_DIR = $stateDir
  $env:METAKIP_CONFIG_DIR = $configDir
  & $binaryPath uninstall --purge --yes
  if ($LASTEXITCODE -ne 0) { throw "standalone uninstall exited with $LASTEXITCODE" }

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $receiptPath = Join-Path $stateDir 'install.json'
  while (((Test-Path -LiteralPath $binaryPath) -or (Test-Path -LiteralPath $receiptPath) -or @(Get-ChildItem -LiteralPath $stateDir -Filter 'uninstall-*.ps1' -ErrorAction SilentlyContinue).Count -gt 0) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (Test-Path -LiteralPath (Join-Path $stateDir 'uninstall-failure.txt') -PathType Leaf) {
    throw "deferred uninstall failed: $([IO.File]::ReadAllText((Join-Path $stateDir 'uninstall-failure.txt')))"
  }
  if (Test-Path -LiteralPath $binaryPath) { throw 'standalone CLI E2E: binary was not removed' }
  if (Test-Path -LiteralPath $receiptPath) { throw 'standalone CLI E2E: receipt was not removed' }
  if (Test-Path -LiteralPath (Join-Path $configDir 'config.json')) { throw 'standalone CLI E2E: config was not removed' }
  if ([IO.File]::ReadAllText($profilePath) -ne $profileBefore) { throw 'standalone CLI E2E: shell profile was changed' }
} finally {
  Remove-Item Env:METAKIP_INSTALL_STATE_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:METAKIP_CONFIG_DIR -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# Bifrost @VERSION@ setup for Windows (run "Install Bifrost.cmd" one folder up).
#
# Downloads the Electron @ELECTRON@ runtime for both x64 and ARM64 from GitHub, checks each against the
# checksum published with that release, and makes:
#   BifrostPortable\              portable Bifrost with both builds; BifrostPortable.exe starts the right one
#                                 for the PC it's on, and both share one Data folder (your profile)
#   Installers\Bifrost-Setup-@VERSION@-x64.exe     install Bifrost as an app on x64 PCs
#   Installers\Bifrost-Setup-@VERSION@-arm64.exe   install Bifrost as an app on ARM64 PCs
# Running it again updates BifrostPortable in place and keeps its Data folder.
#
#   -Target <folder>       where BifrostPortable goes (default: next to "Install Bifrost.cmd", or, when the
#                          setup was unzipped into a PortableApps.com "PortableApps" folder, in that folder)
#   -X64Zip / -Arm64Zip <file>
#                          use Electron zips you already downloaded instead of downloading them
#   -NoPrompt              don't ask questions at the end
param(
  [string]$Target = '',
  [string]$X64Zip = '',
  [string]$Arm64Zip = '',
  [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Version = '@VERSION@'
$Electron = '@ELECTRON@'
$ElectronBase = '@ELECTRON_BASE@'
$Sha = @{ 'x64' = '@SHA_X64@'; 'arm64' = '@SHA_ARM64@' }
$Files = $PSScriptRoot
$Root = Split-Path -Parent $Files

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

function Get-Arch {
  $a = $env:PROCESSOR_ARCHITEW6432
  if (-not $a) { $a = $env:PROCESSOR_ARCHITECTURE }
  if ($a -eq 'ARM64') { return 'arm64' }
  if ($a -eq 'AMD64' -or -not $a) { return 'x64' }
  throw "Bifrost needs 64-bit Windows (x64 or ARM64); this PC reports '$a'."
}

function Get-ElectronZip([string]$arch, [string]$dir, [string]$given) {
  $name = "electron-v$Electron-win32-$arch.zip"
  $zip = Join-Path $dir $name
  if ($given) {
    Copy-Item -LiteralPath $given -Destination $zip
  } else {
    $url = $ElectronBase + [Uri]::EscapeDataString($name)
    Say "Downloading the Electron $Electron runtime for $arch (about 160 MB)..."
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
      & $curl.Path -L --fail --retry 3 --progress-bar -o $zip $url
      if ($LASTEXITCODE -ne 0) { throw "The download failed (curl exit code $LASTEXITCODE)." }
    } else {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    }
  }
  $have = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($have -ne $Sha[$arch]) { throw "The Electron $arch download doesn't match its published checksum (got $have). Nothing was changed; try again." }
  Say "Checksum OK ($arch)." 'DarkGreen'
  return $zip
}

function Expand-Runtime([string]$zip, [string]$dir) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  $ok = $false
  if ($tar) {
    & $tar.Path -xf $zip -C $dir
    $ok = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath (Join-Path $dir 'electron.exe'))
  }
  if (-not $ok) { Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force }
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'electron.exe'))) { throw 'The Electron archive had no electron.exe in it.' }
}

# Builds everything with Electron's own Node (ELECTRON_RUN_AS_NODE), using assemble.cjs next to this script.
function Invoke-Assemble([string]$node, [string[]]$params, [string]$logDir) {
  $script = Join-Path $Files 'assemble.cjs'
  $log = Join-Path $logDir 'assemble.log'
  $err = Join-Path $logDir 'assemble.err.log'
  $argList = @("`"$script`"") + ($params | ForEach-Object { "`"$_`"" })
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    $p = Start-Process -FilePath $node -ArgumentList $argList -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError $err
    # Windows PowerShell 5.1 only keeps a process's exit code if its handle was opened while it ran.
    $null = $p.Handle
    # Show progress while it works.
    $shown = 0
    while (-not $p.HasExited) {
      Start-Sleep -Milliseconds 400
      if (Test-Path -LiteralPath $log) {
        $lines = @(Get-Content -LiteralPath $log -ErrorAction SilentlyContinue)
        for ($i = $shown; $i -lt $lines.Count; $i++) { if ($lines[$i] -notmatch 'zipped') { Say "  $($lines[$i])" } }
        $shown = $lines.Count
      }
    }
    $p.WaitForExit()
  } finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $log) { $lines = @(Get-Content -LiteralPath $log); for ($i = $shown; $i -lt $lines.Count; $i++) { if ($lines[$i] -notmatch 'zipped') { Say "  $($lines[$i])" } } }
  if (Test-Path -LiteralPath $err) { Get-Content -LiteralPath $err | ForEach-Object { if ($_.Trim()) { Say "  $_" 'Yellow' } } }
  $code = $p.ExitCode
  if ($null -eq $code -or "$code" -eq '') {
    # No exit code to read: go by what assemble.cjs said it finished.
    $done = (Test-Path -LiteralPath $log) -and (Select-String -LiteralPath $log -SimpleMatch -Quiet -Pattern ' is ready: ')
    $code = if ($done) { 0 } else { 1 }
  }
  if ($code -ne 0) { throw "Putting Bifrost together failed (exit code $code)." }
}

$work = $null
try {
  Say "Bifrost $Version setup" 'Magenta'
  if (-not $Target) {
    # Unzipped into a PortableApps.com platform's PortableApps folder: install next to the other apps there.
    $parent = Split-Path -Parent $Root
    if ((Split-Path -Leaf $parent) -eq 'PortableApps') { $Target = Join-Path $parent 'BifrostPortable' }
    else { $Target = Join-Path $Root 'BifrostPortable' }
  }
  $Target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Target)
  $Installers = Join-Path $Root 'Installers'
  $app = Join-Path $Files 'app'
  if (-not (Test-Path -LiteralPath (Join-Path $app 'package.json'))) { throw "The 'files\app' folder is missing. Unzip the whole setup first." }

  $running = Get-Process -Name Bifrost, BifrostPortable -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Target, [StringComparison]::OrdinalIgnoreCase) }
  if ($running) { throw "Bifrost is running from $Target. Close it, then run the setup again." }

  $arch = Get-Arch
  Say "This PC: Windows $arch."
  Say "Portable Bifrost (x64 + ARM64) goes in: $Target"
  Say "Installers go in: $Installers"
  $work = Join-Path ([IO.Path]::GetTempPath()) ('bifrost-setup-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $zips = @{ 'x64' = (Get-ElectronZip 'x64' $work $X64Zip); 'arm64' = (Get-ElectronZip 'arm64' $work $Arm64Zip) }
  Say 'Unpacking...'
  $rt = @{}
  foreach ($a in @('x64', 'arm64')) { $rt[$a] = Join-Path $work "runtime-$a"; Expand-Runtime $zips[$a] $rt[$a] }
  foreach ($a in @('x64', 'arm64')) { Remove-Item -LiteralPath $zips[$a] -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Path $Installers -Force | Out-Null
  Say 'Putting Bifrost together (this takes a minute or two)...'
  # This PC's own runtime does the work (an ARM64 program can't run on x64 Windows).
  $node = Join-Path $rt[$arch] 'electron.exe'
  # (Bifrost's own tests run this setup on Linux, with a Node of their choosing.)
  if ($env:BIFROST_SETUP_NODE) { $node = $env:BIFROST_SETUP_NODE }
  Invoke-Assemble $node @('dual', "--x64=$($rt['x64'])", "--arm64=$($rt['arm64'])", "--app=$app", "--out=$Target", "--installers=$Installers", "--stubs=$(Join-Path $Files 'win')") $work

  $mine = Join-Path $Installers "Bifrost-Setup-$Version-$arch.exe"
  Say ''
  Say "Done." 'Green'
  Say "  Portable:   $Target\BifrostPortable.exe"
  Say "  Installers: $Installers\Bifrost-Setup-$Version-x64.exe"
  Say "              $Installers\Bifrost-Setup-$Version-arm64.exe"
  Say 'The portable copy keeps your bookmarks, history and settings in its Data folder; an installed copy'
  Say 'keeps them in %APPDATA%\Bifrost.'
  $code = 0
  if (-not $NoPrompt) {
    $answer = Read-Host "Install Bifrost as an app on this PC now ($arch)? [y/N]"
    if ($answer -match '^[yY]') { Start-Process -FilePath $mine }
    else {
      $answer = Read-Host 'Start the portable Bifrost now? [Y/n]'
      if ($answer -eq '' -or $answer -match '^[yY]') { Start-Process -FilePath (Join-Path $Target 'BifrostPortable.exe') -WorkingDirectory $Target }
    }
  }
} catch {
  Say ''
  Say ('Setup failed: ' + $_.Exception.Message) 'Red'
  if (-not $NoPrompt) { Read-Host 'Press Enter to close' | Out-Null }
  $code = 1
} finally {
  if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
exit $code

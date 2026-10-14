# One-shot runner for the n8n smoke test.
#
# WHY: bash background jobs on this host fail instantly with "stdin is not a tty"
# the moment a node script reads process.env or forks, so the smoke test cannot be
# launched from the bash terminal. PowerShell gives the child a real console.
#
# Usage: powershell -ExecutionPolicy Bypass -File run-smoke.ps1 -Log <path> -Business <name>

param(
  [string]$Log = "",
  [string]$Business = "Fix Verify Clinic"
)

if ($Log -eq "") { $Log = Join-Path $env:TEMP "anagata-smoke.log" }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

"=== $(Get-Date -Format o) root=$root business=$Business ===" | Out-File $Log -Encoding utf8

$out = & node n8n/scripts/smoke-site-builder.mjs $Business 2>&1
$code = $LASTEXITCODE
$out | Out-File $Log -Append -Encoding utf8
"=== exit code: $code ===" | Out-File $Log -Append -Encoding utf8

$out
"exit=$code log=$Log"
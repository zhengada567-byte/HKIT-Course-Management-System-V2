# Export full public schema + constraints from Supabase PostgreSQL.
#
# Prerequisites (choose one):
#   A) PostgreSQL client installed (pg_dump in PATH)
#   B) Docker Desktop installed
#
# Usage:
#   cd "d:\Game\HKIT Course Management System V2"
#   .\scripts\export-database-schema.ps1
#
# Output:
#   supabase\live_schema_YYYYMMDD_HHMMSS.sql
#   supabase\live_schema_YYYYMMDD_HHMMSS.meta.txt

param(
  [string]$ProjectRef = "",
  [string]$DbPassword = "",
  [string]$OutputDir = "supabase"
)

$ErrorActionPreference = "Stop"

function Get-ProjectRefFromEnv {
  $envFile = Join-Path (Join-Path $PSScriptRoot "..") ".env"
  if (-not (Test-Path $envFile)) {
    return ""
  }

  $urlLine = Get-Content $envFile | Where-Object { $_ -match "^VITE_SUPABASE_URL=" } | Select-Object -First 1
  if (-not $urlLine) {
    return ""
  }

  $url = ($urlLine -split "=", 2)[1].Trim().Trim('"')
  if ($url -match "https://([^.]+)\.supabase\.co") {
    return $Matches[1]
  }

  return ""
}

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$resolvedProjectRef = $ProjectRef
if (-not $resolvedProjectRef) {
  $resolvedProjectRef = Get-ProjectRefFromEnv
}

if (-not $resolvedProjectRef) {
  throw "Project ref not found. Pass -ProjectRef or set VITE_SUPABASE_URL in .env"
}

if (-not $DbPassword) {
  $secure = Read-Host "Enter Supabase DB password (Dashboard -> Project Settings -> Database)" -AsSecureString
  $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Resolve-Path (Join-Path (Join-Path $PSScriptRoot "..") $OutputDir)
$schemaFile = Join-Path $outDir "live_schema_$timestamp.sql"
$metaFile = Join-Path $outDir "live_schema_$timestamp.meta.txt"

$hostName = "db.$resolvedProjectRef.supabase.co"
$pgDumpArgs = @(
  "-h", $hostName,
  "-p", "5432",
  "-U", "postgres",
  "-d", "postgres",
  "--schema-only",
  "--schema=public",
  "--no-owner",
  "--no-privileges",
  "-f", $schemaFile
)

Write-Host "Exporting schema from $hostName ..."
Write-Host "Output: $schemaFile"

$exported = $false

if (Test-CommandExists "pg_dump") {
  $env:PGPASSWORD = $DbPassword
  try {
    & pg_dump @pgDumpArgs
    if ($LASTEXITCODE -ne 0) {
      throw "pg_dump failed with exit code $LASTEXITCODE"
    }
    $exported = $true
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
} elseif (Test-CommandExists "docker") {
  $dockerArgs = @(
    "run", "--rm",
    "-e", "PGPASSWORD=$DbPassword",
    "-v", "${outDir}:/out",
    "postgres:16-alpine",
    "pg_dump",
    "-h", $hostName,
    "-p", "5432",
    "-U", "postgres",
    "-d", "postgres",
    "--schema-only",
    "--schema=public",
    "--no-owner",
    "--no-privileges",
    "-f", "/out/live_schema_$timestamp.sql"
  )

  & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker pg_dump failed with exit code $LASTEXITCODE"
  }
  $exported = $true
} else {
  Write-Host ""
  Write-Host "pg_dump/docker not found." -ForegroundColor Yellow
  Write-Host "Use SQL Editor fallback instead:" -ForegroundColor Yellow
  Write-Host "  scripts/export-database-schema.sql" -ForegroundColor Yellow
  Write-Host ""
  exit 2
}

if (-not $exported -or -not (Test-Path $schemaFile)) {
  throw "Schema export file was not created."
}

@"
Export time: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Project ref: $resolvedProjectRef
Host: $hostName
Schema file: $schemaFile

Send this file to the assistant for schema/constraint reference.
"@ | Set-Content -Path $metaFile -Encoding UTF8

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Schema: $schemaFile"
Write-Host "Meta:   $metaFile"
Write-Host ""
Write-Host "Next: share live_schema_*.sql in chat." -ForegroundColor Cyan

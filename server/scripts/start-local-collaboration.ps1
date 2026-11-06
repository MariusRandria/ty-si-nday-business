$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$sourceEnv = Join-Path $serverRoot '.env'

if (-not (Test-Path $sourceEnv)) {
  throw 'server/.env is required.'
}

$allowedSourceVariables = @(
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'COLLABORATION_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'CLIENT_ORIGINS',
  'CLIENT_ORIGIN',
  'PORT'
)

foreach ($line in Get-Content $sourceEnv) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
  $separator = $trimmed.IndexOf('=')
  $name = $trimmed.Substring(0, $separator).Trim()
  if ($allowedSourceVariables -notcontains $name) { continue }
  $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
  Set-Item -Path ("Env:" + $name) -Value $value
}

if (-not $env:DATABASE_URL) { throw 'DATABASE_URL is missing.' }
$target = [Uri]$env:DATABASE_URL
if ($target.Host -notin @('localhost', '127.0.0.1', '::1')) {
  throw 'This local starter is restricted to a loopback database host.'
}
if ($target.AbsolutePath.TrimStart('/').ToLowerInvariant() -ne 'cominnovt') {
  throw 'This local starter is restricted to the explicitly authorized cominnovt database.'
}
if (-not $env:COLLABORATION_ENCRYPTION_KEY) {
  throw 'COLLABORATION_ENCRYPTION_KEY must be configured in server/.env; refusing to start without the existing encryption key.'
}
try {
  $encryptionKey = [Convert]::FromBase64String($env:COLLABORATION_ENCRYPTION_KEY)
}
catch {
  throw 'COLLABORATION_ENCRYPTION_KEY in server/.env must be a canonical base64-encoded 32-byte key.'
}
if ($encryptionKey.Length -ne 32 -or [Convert]::ToBase64String($encryptionKey) -cne $env:COLLABORATION_ENCRYPTION_KEY) {
  throw 'COLLABORATION_ENCRYPTION_KEY in server/.env must be a canonical base64-encoded 32-byte key.'
}

$env:COLLABORATION_SCHEDULER_ENABLED = 'true'
$env:DOTENV_CONFIG_PATH = $sourceEnv
Write-Output 'Starting with server/.env, including Google and SMTP settings, with the collaboration scheduler enabled.'
Push-Location $serverRoot
try {
  & npm.cmd run dev
  if ($LASTEXITCODE -ne 0) { throw "API process exited with code $LASTEXITCODE." }
}
finally {
  Pop-Location
}

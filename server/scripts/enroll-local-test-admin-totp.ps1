param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$AdminId
)

$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$sourceEnv = Join-Path $serverRoot '.env'
$localEnv = Join-Path $serverRoot '.env.local'

if (-not (Test-Path $sourceEnv) -or -not (Test-Path $localEnv)) {
  throw 'Both server/.env and server/.env.local are required.'
}

foreach ($name in @('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM')) {
  Remove-Item -Path ("Env:" + $name) -ErrorAction SilentlyContinue
}

$allowedSourceVariables = @(
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'COLLABORATION_ENCRYPTION_KEY'
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

foreach ($line in Get-Content $localEnv) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
  $separator = $trimmed.IndexOf('=')
  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
  Set-Item -Path ("Env:" + $name) -Value $value
}

if ($env:SMTP_HOST -or $env:SMTP_USER -or $env:SMTP_PASSWORD -or $env:SMTP_FROM) {
  $mailpitConfigurationIsSafe = $env:SMTP_HOST -eq '127.0.0.1' -and $env:SMTP_PORT -eq '1025' -and $env:SMTP_SECURE -eq 'false' -and $env:SMTP_USER -eq 'test' -and $env:SMTP_PASSWORD -eq 'test' -and $env:SMTP_FROM -match '^Ty sy Nday Test <[^<>@\s]+@example\.invalid>$'
  if (-not $mailpitConfigurationIsSafe) {
    throw 'SMTP is restricted to local Mailpit at 127.0.0.1:1025 with test-only credentials and an example.invalid sender.'
  }
}

if (-not $env:DATABASE_URL) { throw 'DATABASE_URL is missing.' }
$target = [Uri]$env:DATABASE_URL
if ($target.Host -notin @('localhost', '127.0.0.1', '::1') -or $target.AbsolutePath.TrimStart('/').ToLowerInvariant() -ne 'cominnovt') {
  throw 'Refusing TOTP enrollment: DATABASE_URL must target localhost/cominnovt.'
}
if ($env:COLLABORATION_SCHEDULER_ENABLED -ne 'false') {
  throw 'Refusing TOTP enrollment: collaboration scheduler must remain disabled.'
}
if (-not $env:COLLABORATION_ENCRYPTION_KEY) {
  throw 'COLLABORATION_ENCRYPTION_KEY is missing.'
}

$env:DOTENV_CONFIG_PATH = $localEnv
Push-Location $serverRoot
try {
  & npx.cmd tsx scripts/enroll-local-test-admin-totp.ts "--admin-id=$AdminId"
  if ($LASTEXITCODE -ne 0) { throw "TOTP enrollment exited with code $LASTEXITCODE." }
}
finally {
  Pop-Location
}

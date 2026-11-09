. (Join-Path $PSScriptRoot 'common.ps1')
Assert-PostgresInstalled
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) { Write-Output 'The local PostgreSQL cluster is already stopped.'; exit 0 }
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -w -t 30 -m fast stop
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to stop.' }
Write-Output 'PostgreSQL stopped. Local database files are retained.'

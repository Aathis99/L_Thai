. (Join-Path $PSScriptRoot 'common.ps1')
Assert-PostgresInstalled
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 5433 -U lthai -d lthai
exit $LASTEXITCODE

. (Join-Path $PSScriptRoot 'common.ps1')
Assert-PostgresInstalled
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    throw 'The local PostgreSQL cluster is missing. Run scripts/database/setup.ps1 first.'
}
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
    $process = Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D', ('"' + $pgData + '"'), '-l', ('"' + $pgLog + '"'), '-w', '-t', '30', 'start') -WindowStyle Hidden -PassThru
    # Wait only for pg_ctl; Start-Process -Wait also waits for the long-lived server.
    if (-not $process.WaitForExit(35000)) { throw "PostgreSQL startup timed out. See $pgLog" }
    if ($process.ExitCode -ne 0) { throw "PostgreSQL failed to start. See $pgLog" }
}
& (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 5433 -U lthai -d lthai
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL is not accepting connections on 127.0.0.1:5433.' }
Write-Output 'PostgreSQL is ready at 127.0.0.1:5433 (database: lthai, user: lthai).'

. (Join-Path $PSScriptRoot 'common.ps1')

# Official EDB Windows archive, linked from https://www.enterprisedb.com/download-postgresql-binaries.
# SHA-256 confirmed by EDB at https://github.com/EnterpriseDB/edb-installers/issues/746.
$archiveUrl = 'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip'
$expectedHash = 'e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2'
$toolDirectory = Join-Path $projectRoot '.tools/postgresql'
$archivePath = Join-Path $toolDirectory 'postgresql.zip'
if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'initdb.exe'))) {
    [System.IO.Directory]::CreateDirectory($toolDirectory) | Out-Null
    if (-not (Test-Path -LiteralPath $archivePath)) {
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
        throw 'PostgreSQL archive checksum mismatch. Existing files were retained for inspection.'
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $toolDirectory
}
Assert-PostgresInstalled
& (Join-Path $pgBin 'postgres.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL cannot run. Check Windows runtime dependencies.' }

if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    $passwordFile = Join-Path $projectRoot 'data/postgres-init.pwfile'
    try {
        [System.IO.File]::WriteAllText($passwordFile, (Get-DatabasePassword), [System.Text.UTF8Encoding]::new($false))
        & (Join-Path $pgBin 'initdb.exe') -D $pgData -U lthai --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$passwordFile
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL cluster initialization failed.' }
    } finally {
        if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
    }
    [System.IO.File]::AppendAllText((Join-Path $pgData 'postgresql.conf'), "`n# LThai local runtime`nlisten_addresses = '127.0.0.1'`nport = 5433`npassword_encryption = 'scram-sha-256'`ntimezone = 'Asia/Bangkok'`n", [System.Text.UTF8Encoding]::new($false))
}
& (Join-Path $PSScriptRoot 'start.ps1')
$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = Get-DatabasePassword
    $databaseExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 5433 -U lthai -d postgres -X -A -t -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = 'lthai'"
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL authentication failed.' }
    if ($databaseExists -ne '1') {
        & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 5433 -U lthai -O lthai -T template0 -E UTF8 lthai
        if ($LASTEXITCODE -ne 0) { throw 'Could not create database lthai.' }
    }
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 5433 -U lthai -d lthai -X -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user, version();'
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL connection validation failed.' }
} finally {
    $env:PGPASSWORD = $previousPassword
}

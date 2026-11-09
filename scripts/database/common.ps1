$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pgBin = Join-Path $projectRoot '.tools/postgresql/pgsql/bin'
$pgData = Join-Path $projectRoot 'data/postgres'
$pgLog = Join-Path $projectRoot 'data/postgres.log'

function Assert-PostgresInstalled {
    if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'pg_ctl.exe'))) {
        throw 'Portable PostgreSQL is missing. Run scripts/database/setup.ps1 first.'
    }
}

function Get-DatabasePassword {
    $connectionPath = Join-Path $projectRoot 'data/connection-info.txt'
    if (-not (Test-Path -LiteralPath $connectionPath)) {
        throw 'Missing private data/connection-info.txt. Configure the PostgreSQL password first.'
    }
    $passwordLine = Get-Content -LiteralPath $connectionPath | Where-Object { $_.StartsWith('Password=') } | Select-Object -First 1
    if (-not $passwordLine -or $passwordLine.Length -le 9) { throw 'Missing Password= in private connection file.' }
    return $passwordLine.Substring(9)
}

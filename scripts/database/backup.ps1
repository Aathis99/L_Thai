. (Join-Path $PSScriptRoot 'common.ps1')
Assert-PostgresInstalled
$backupDirectory = Join-Path $projectRoot 'data/backups'
[System.IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
$backupName = 'lthai-' + (Get-Date).ToString('yyyyMMdd-HHmmss-fff', [System.Globalization.CultureInfo]::InvariantCulture) + '.dump'
$backupPath = Join-Path $backupDirectory $backupName
$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = Get-DatabasePassword
    & (Join-Path $pgBin 'pg_dump.exe') -h 127.0.0.1 -p 5433 -U lthai -d lthai -Fc -f $backupPath
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL backup failed.' }
    Write-Output "Backup saved: $backupPath"
} finally {
    $env:PGPASSWORD = $previousPassword
}

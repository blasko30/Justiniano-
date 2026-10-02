param(
    [string]$CloudDatabaseUrl = $env:CLOUD_DATABASE_URL,
    [string]$DumpFile = "db_schema_migration.sql",
    [switch]$ReplaceExisting
)

$ErrorActionPreference = "Stop"
$backendRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if ([string]::IsNullOrWhiteSpace($CloudDatabaseUrl)) {
    throw "Define CLOUD_DATABASE_URL o proporciona -CloudDatabaseUrl con la URL PostgreSQL de destino."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker no esta disponible en PATH."
}

$dumpPath = if ([System.IO.Path]::IsPathRooted($DumpFile)) {
    [System.IO.Path]::GetFullPath($DumpFile)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $backendRoot $DumpFile))
}
$dumpDirectory = Split-Path -Parent $dumpPath
New-Item -ItemType Directory -Force -Path $dumpDirectory | Out-Null

$dumpArgs = @(
    "compose", "exec", "-T", "db", "pg_dump",
    "-U", "justiniano",
    "-d", "justiniano",
    "--format=plain",
    "--schema-only",
    "--no-owner",
    "--no-acl",
    "--no-comments"
)

if ($ReplaceExisting) {
    $dumpArgs += @("--clean", "--if-exists")
    Write-Warning "La importacion eliminara objetos existentes en la base de destino."
}

Push-Location $backendRoot
try {
    Write-Host "Exportando solo el esquema PostgreSQL local a $dumpPath ..."
    & docker @dumpArgs | Set-Content -LiteralPath $dumpPath -Encoding UTF8
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump fallo con codigo $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path $dumpPath) -or (Get-Item $dumpPath).Length -eq 0) {
    throw "El dump generado esta vacio: $dumpPath"
}

Write-Host "Importando solo tablas, columnas, indices y restricciones en PostgreSQL cloud ..."
Get-Content -LiteralPath $dumpPath | & docker run --rm -i postgres:16-alpine psql `
    --dbname=$CloudDatabaseUrl --set=ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw "La importacion en PostgreSQL cloud fallo con codigo $LASTEXITCODE."
}

Write-Host "Migracion completada correctamente. Dump local: $dumpPath"
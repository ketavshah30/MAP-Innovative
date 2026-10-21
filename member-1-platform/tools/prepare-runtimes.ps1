param([ValidateSet('go','dotnet')][string]$Runtime)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$toolRoot = Join-Path $projectRoot '.local/tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
if ($Runtime -eq 'go') {
    $releases = Invoke-RestMethod 'https://go.dev/dl/?mode=json&include=all'
    $release = $releases | Where-Object version -eq 'go1.23.6' | Select-Object -First 1
    $asset = $release.files | Where-Object { $_.os -eq 'windows' -and $_.arch -eq 'amd64' -and $_.kind -eq 'archive' } | Select-Object -First 1
    if (-not $asset) { throw 'Go archive metadata not found' }
    $archive = Join-Path $toolRoot $asset.filename
    Invoke-WebRequest ('https://go.dev/dl/' + $asset.filename) -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $asset.sha256) { throw 'Go archive checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force
} else {
    $metadata = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json'
    $sdk = $metadata.releases[0].sdk
    $asset = $sdk.files | Where-Object { $_.rid -eq 'win-x64' -and $_.url.EndsWith('.zip') } | Select-Object -First 1
    if (-not $asset) { throw '.NET SDK archive metadata not found' }
    $archive = Join-Path $toolRoot 'dotnet-sdk.zip'
    Invoke-WebRequest $asset.url -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash -ne $asset.hash) { throw '.NET SDK archive checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolRoot 'dotnet') -Force
}
Write-Output "Prepared $Runtime under $toolRoot; no system PATH or global installation changed."

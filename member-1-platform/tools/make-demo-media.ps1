$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mediaDirectory = Join-Path $projectRoot '.local/media/demo'
if (Test-Path -LiteralPath (Join-Path $mediaDirectory 'master.m3u8')) { throw 'Demo media already exists; preserving it.' }
New-Item -ItemType Directory -Force -Path $mediaDirectory | Out-Null
Push-Location $mediaDirectory
try {
    & ffmpeg -nostdin -f lavfi -i 'testsrc=size=320x180:rate=24' -f lavfi -i 'sine=frequency=440:sample_rate=44100' -t 10 -c:v libx264 -pix_fmt yuv420p -c:a aac -hls_time 2 -hls_list_size 0 -hls_segment_filename 'segment-%03d.ts' -f hls master.m3u8
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg generation failed' }
} finally { Pop-Location }

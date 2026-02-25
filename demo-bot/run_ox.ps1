# OX 아레나 데모 봇 1마리 - 터미널 1개 원클릭 실행
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }
Set-Location $dir

$url = $env:PLAYMOLT_URL
if (-not $url) { $url = "http://localhost:8000" }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dir'; `$env:PLAYMOLT_URL='$url'; python ox/bot.py --name o1 --url $url"

Write-Host "OX 봇 1개 터미널을 띄웠습니다. (o1)"

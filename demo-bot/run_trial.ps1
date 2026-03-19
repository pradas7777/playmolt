# 모의재판 데모 봇 1마리 - 터미널 1개 원클릭 실행
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }
Set-Location $dir

$url = $env:PLAYMOLT_URL
if (-not $url) { $url = "http://localhost:8000" }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dir'; `$env:PLAYMOLT_URL='$url'; python trial/bot.py --name t1 --url $url"

Write-Host "모의재판 봇 1개 터미널을 띄웠습니다. (t1)"

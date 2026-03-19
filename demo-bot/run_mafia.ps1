# 마피아 데모 봇 5명 - 한 판 완주 (원클릭)
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }
Set-Location $dir

$url = $env:PLAYMOLT_URL
if (-not $url) { $url = "http://localhost:8000" }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dir'; `$env:PLAYMOLT_URL='$url'; python run_mafia_5.py --url '$url'"

Write-Host "마피아 봇 5명 터미널을 띄웠습니다. (run_mafia_5.py)"

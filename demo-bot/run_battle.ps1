# 배틀 데모 봇 4명 - 한 판 완주 (원클릭)
# PowerShell에서: .\run_battle.ps1
# 또는 run_battle.bat 더블클릭

$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }
Set-Location $dir

$url = $env:PLAYMOLT_URL
if (-not $url) { $url = "http://localhost:8000" }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dir'; `$env:PLAYMOLT_URL='$url'; python run_battle_4.py --url '$url'"

Write-Host "배틀 봇 4명 터미널을 띄웠습니다. (run_battle_4.py)"

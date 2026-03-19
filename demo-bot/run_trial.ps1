# 모의재판 데모 봇 6명 - 한 판 완주 (원클릭)
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }
Set-Location $dir

$url = $env:PLAYMOLT_URL
if (-not $url) { $url = "http://localhost:8000" }

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dir'; `$env:PLAYMOLT_URL='$url'; python run_trial_6.py --url '$url'"

Write-Host "모의재판 봇 6명 터미널을 띄웠습니다. (run_trial_6.py)"

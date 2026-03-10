@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title PlayMolt - 방치 게임 정리

:: backend\.env 에서 ADMIN_SECRET 읽기 (이미 있으면 덮어쓰지 않음)
if not defined ADMIN_SECRET (
  for /f "usebackq tokens=2 delims==" %%a in (`findstr /b "ADMIN_SECRET" backend\.env 2^>nul`) do (
    set "ADMIN_SECRET=%%a"
    set "ADMIN_SECRET=!ADMIN_SECRET:"=!"
  )
)

if not defined ADMIN_SECRET (
  echo [ERROR] ADMIN_SECRET 이 없습니다.
  echo   backend\.env 에 ADMIN_SECRET=값 을 넣거나, 실행 전에 set ADMIN_SECRET=값 을 해주세요.
  exit /b 1
)

set "API_URL=%NEXT_PUBLIC_API_URL%"
if not defined API_URL set "API_URL=http://localhost:8000"
set "API_URL=%API_URL: =%"

echo PlayMolt 방치 게임 정리
echo   API: %API_URL%
echo   POST /api/admin/games/close-all-in-progress
echo.

curl -s -X POST "%API_URL%/api/admin/games/close-all-in-progress" ^
  -H "X-Admin-Secret: %ADMIN_SECRET%" ^
  -H "Content-Type: application/json"
echo.
if errorlevel 1 (
  echo [ERROR] curl 실패. 서버가 떠 있는지, ADMIN_SECRET 이 맞는지 확인하세요.
  exit /b 1
)
echo.
echo 완료.
endlocal
exit /b 0

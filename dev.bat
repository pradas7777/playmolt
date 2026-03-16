@echo off
set "ROOT=%~dp0"
echo [PlayMolt] Backend 8000 and Frontend 3000 starting...
echo Project: %ROOT%
echo.
start "PlayMolt Backend" cmd /k "cd /d "%ROOT%backend" && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
timeout /t 2 /nobreak >nul
start "PlayMolt Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3000
echo Close each window to stop the servers.
pause

@echo off
echo.
echo  EmailBison Campaign Deployer - Starting
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js is required. Install from https://nodejs.org
  pause
  exit /b 1
)

echo [OK] Node.js detected

echo.
echo [1/2] Installing backend dependencies...
cd /d "%~dp0backend"
call npm install --silent

echo [2/2] Installing frontend dependencies...
cd /d "%~dp0frontend"
call npm install --silent

echo.
echo Starting backend...
cd /d "%~dp0backend"
start "EmailBison Backend" cmd /c "node server.js"

echo Starting frontend...
cd /d "%~dp0frontend"
set BROWSER=none
start "EmailBison Frontend" cmd /c "npm start"

echo.
echo  Tool running at: http://localhost:3000
echo  Close both CMD windows to stop.
echo.
pause

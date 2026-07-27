@echo off
title SearchLens - SEO & AI Searchability Checker
cd /d "%~dp0"

REM Install dependencies the first time only.
if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  echo.
)

REM Open the app in your default browser a couple seconds after the server starts.
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:3000"

echo.
echo  SearchLens is starting at http://localhost:3000
echo  Leave this window open while you use it. Close it to stop the app.
echo.

node server.js
pause

@echo off
REM Double-click to open Net Worth Tracker.
REM  - Once the app is on GitHub Pages, put its address below and this simply opens it.
REM  - Until then, it serves the built app (out\) on http://localhost:3000 from this PC.
REM    No Node.js or admin rights are needed for this.
title Net Worth Tracker
cd /d "%~dp0"
set "APP_URL=https://yxu263.github.io/net-worth-tracker/"
REM To run the local copy (out\) instead, change the line above to: set "APP_URL="

if defined APP_URL (
  start "" "%APP_URL%"
  exit /b 0
)

if not exist "out\index.html" (
  echo The app has not been built yet ^(out\index.html is missing^).
  echo Build it once with Node.js:  npm ci  then  npm run build
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo Net Worth Tracker is already running. Opening it in your browser...
  start "" "http://localhost:3000/"
  timeout /t 2 >nul
  exit /b 0
)

start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000/'"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\serve.ps1" -Port 3000
pause
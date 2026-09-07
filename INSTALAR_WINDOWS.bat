@echo off
setlocal
chcp 65001 >nul
title Instalador AGROSUD Flat Price Terminal Pro v3.2
cd /d "%~dp0"
echo.
echo ============================================================
echo              INSTALADOR AGROSUD TERMINAL v3.2
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: primero instalá Node.js LTS 18 o superior desde:
  echo https://nodejs.org/
  pause
  exit /b 1
)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo ERROR durante npm install.
  pause
  exit /b 1
)
call npm run verify
if errorlevel 1 (
  echo ERROR durante la verificación.
  pause
  exit /b 1
)
if not exist .env copy /y .env.example .env >nul
echo.
echo Instalación completada correctamente.
echo Ahora ejecutá INICIAR_WINDOWS.bat
echo.
pause

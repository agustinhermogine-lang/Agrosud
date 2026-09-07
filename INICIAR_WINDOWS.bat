@echo off
setlocal
chcp 65001 >nul
title AGROSUD Flat Price Terminal Pro v3.2
cd /d "%~dp0"

echo.
echo ============================================================
echo        AGROSUD FLAT PRICE TERMINAL PRO v3.2 FINAL
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no está instalado o no está agregado al PATH.
  echo Instalá Node.js LTS 18 o superior desde https://nodejs.org/
  echo Luego cerrá esta ventana y volvé a ejecutar este archivo.
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo Node detectado: %%i

if not exist node_modules\express (
  echo.
  echo Primera ejecución: instalando dependencias...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERROR: no se pudieron instalar las dependencias.
    echo Verificá tu conexión a Internet y que npm funcione correctamente.
    echo Podés probar manualmente: npm install
    pause
    exit /b 1
  )
)

echo.
echo Verificando archivos del sistema...
call npm run verify
if errorlevel 1 (
  echo.
  echo ERROR: la verificación del programa falló.
  pause
  exit /b 1
)

if not exist .env (
  copy /y .env.example .env >nul
)

echo.
echo Iniciando servidor en http://localhost:3000
echo Para compartirlo en la red local, usá la IP de esta PC con el puerto 3000.
echo Para cerrar el programa presioná Ctrl+C o cerrá esta ventana.
echo.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
node server.js

echo.
echo El servidor se cerró.
pause

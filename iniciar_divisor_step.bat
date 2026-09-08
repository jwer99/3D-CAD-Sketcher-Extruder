@echo off
title Iniciar STEP Partitioner Pro
echo ========================================================
echo        STEP Partitioner Pro - Divisor de Archivos CAD
echo ========================================================
echo.
echo Comprobando servidor 3D CAD Sketcher...

netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo Iniciando servidor en segundo plano...
    start /B npm run dev
    timeout /t 3 >nul
)

echo Abriendo la aplicacion complementaria en tu navegador...
start "" "http://localhost:3000/splitter.html"
echo.
echo Listo! La aplicacion se ha abierto en: http://localhost:3000/splitter.html
echo Puedes minimizar o cerrar esta ventana cuando quieras.
timeout /t 5 >nul

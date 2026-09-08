@echo off
chcp 65001 > nul
title VOXEL3D - Mantener Render Despierto 24/7

echo ===================================================================
echo   VOXEL3D CAD - Keep-Alive Ping para Render (Evitar Cold Starts)
echo ===================================================================
echo Objetivo: https://threed-cad-sketcher-extruder.onrender.com/api/health
echo Intervalo: Cada 10 minutos (Render duerme a los 15 min de inactividad)
echo.
echo Puedes minimizar esta ventana; mantendra la web despierta en Render.
echo ===================================================================
echo.

:loop
echo [%time:~0,8%] Enviando ping a Render...
curl -s -o nul --max-time 45 https://threed-cad-sketcher-extruder.onrender.com/api/health
if %errorlevel% equ 0 (
    echo [%time:~0,8%] ✓ Servidor en Render activo y en linea.
) else (
    echo [%time:~0,8%] [!] Despertando servidor en Render...
)
timeout /t 600 /nobreak > nul
goto loop

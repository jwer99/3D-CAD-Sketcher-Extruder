@echo off
chcp 65001 > nul
title VOXEL3D CAD - Subir a GitHub (jwer99)

echo ===================================================================
echo   SUBIENDO PROYECTO A GITHUB: jwer99 / 3D-CAD-Sketcher-Extruder
echo ===================================================================
echo.
echo Repositorio destino: https://github.com/jwer99/3D-CAD-Sketcher-Extruder.git
echo Rama: main
echo.
echo [1/2] Verificando estado de Git...
git status
echo.
echo [2/2] Subiendo archivos a GitHub...
echo (Se abrira una ventana en tu navegador, pulsa 'Sign in with your browser' / 'Authorize')
echo.
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ===================================================================
    echo  ¡SUBIDA COMPLETADA CON ÉXITO!
    echo  Tu código ya está disponible en:
    echo  https://github.com/jwer99/3D-CAD-Sketcher-Extruder
    echo ===================================================================
) else (
    echo.
    echo [ERROR] No se pudo completar la subida. Revisa el mensaje arriba.
)
echo.
pause

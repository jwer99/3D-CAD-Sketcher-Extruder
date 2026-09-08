@echo off
chcp 65001 > nul
title VOXEL3D CAD - Subir a GitHub (jwer99)

echo ===================================================================
echo             SUBIENDO PROYECTO A GITHUB: jwer99
echo ===================================================================
echo.
echo Repositorio destino: https://github.com/jwer99/3D-CAD-Sketcher-Extruder.git
echo Rama: main
echo.
echo [1/2] Verificando estado de Git...
git status
echo.
echo [2/2] Subiendo archivos a GitHub...
echo (Si Windows te muestra una ventana de autenticación de GitHub, pulsa 'Sign in with your browser')
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
    echo [AVISO] Si dice 'Repository not found', es porque primero debes pulsar
    echo en el botón 'Create repository' en este enlace:
    echo https://github.com/new?name=3D-CAD-Sketcher-Extruder
)
echo.
pause

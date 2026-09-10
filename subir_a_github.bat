@echo off
chcp 65001 > nul
title VOXEL3D CAD - Subir a GitHub (jwer99)

set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\cmd;%LOCALAPPDATA%\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin;%PATH%"

echo ===================================================================
echo   SUBIENDO PROYECTO A GITHUB: jwer99 / 3D-CAD-Sketcher-Extruder
echo ===================================================================
echo.
echo Repositorio destino: https://github.com/jwer99/3D-CAD-Sketcher-Extruder.git
echo Rama: main
echo.

gh auth status >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/3] Iniciando sesión en GitHub...
    echo Se abrirá tu navegador web para autorizar el acceso.
    call gh auth login --hostname github.com -p https -w
    call gh auth setup-git
)

echo.
echo [2/3] Verificando estado de Git...
git status
echo.
echo [3/3] Subiendo archivos a GitHub...
git push -u origin main
git push cad3d main >nul 2>&1

if %errorlevel% equ 0 (
    echo.
    echo ===================================================================
    echo  ¡SUBIDA COMPLETADA CON ÉXITO!
    echo  Tu código ya está disponible en:
    echo  https://github.com/jwer99/3D-CAD-Sketcher-Extruder
    echo  Render actualizará la app online en https://threed-cad-sketcher-extruder.onrender.com
    echo ===================================================================
) else (
    echo.
    echo [ERROR] No se pudo completar la subida. Revisa el mensaje arriba.
)
echo.
pause

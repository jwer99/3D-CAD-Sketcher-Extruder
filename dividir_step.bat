@echo off
title Divisor Rapido de STEP (Arrastrar y Soltar)
echo ======================================================================
echo          STEP Partitioner Pro - Acceso Directo de Windows
echo ======================================================================
echo.

if "%~1"=="" (
    echo [INSTRUCCIONES]
    echo Arrastra y suelta cualquier archivo .step o .stp sobre este archivo .bat
    echo en el Explorador de Windows para dividirlo automaticamente en partes
    echo de menos de 100 MB.
    echo.
    echo O escribe aqui la ruta del archivo STEP de 750 MB:
    set /p "STEP_PATH=Ruta del archivo STEP: "
) else (
    set "STEP_PATH=%~1"
)

if not exist "%STEP_PATH%" (
    echo [ERROR] No se encontro el archivo especificado: %STEP_PATH%
    pause
    exit /b 1
)

echo.
echo Archivo detectado: %STEP_PATH%

if not "%~2"=="" (
    set "MAX_MB=%~2"
) else (
    echo.
    echo Selecciona el tamano maximo por parte:
    echo   [1] 95 MB  (Recomendado para 3D CAD Sketcher)
    echo   [2] 150 MB (Partes de 150 MB)
    echo   [3] 200 MB (Partes de 200 MB)
    echo   [4] Personalizado
    echo.
    set "CHOICE=1"
    set /p "CHOICE=Elige una opcion [1-4, por defecto 1]: "
    if "!CHOICE!"=="2" set "MAX_MB=150"
    if "!CHOICE!"=="3" set "MAX_MB=200"
    if "%CHOICE%"=="2" set "MAX_MB=150"
    if "%CHOICE%"=="3" set "MAX_MB=200"
    if "%CHOICE%"=="4" (
        set /p "MAX_MB=Escribe el tamano en MB: "
    )
)
if not defined MAX_MB set "MAX_MB=95"

echo.
echo Ejecutando motor OpenCASCADE 64-bit...
echo Limite por parte: menor o igual a %MAX_MB% MB
echo.

python "%~dp0server\step_splitter_core.py" "%STEP_PATH%" --max-mb %MAX_MB%

echo.
echo ======================================================================
echo Proceso completado. Abriendo la carpeta con los archivos particionados...
echo ======================================================================

set "OUT_DIR=%~dp1%~n1_partes"
if exist "%OUT_DIR%" (
    start explorer.exe "%OUT_DIR%"
) else (
    start explorer.exe "%~dp0partes_step"
)

echo.
echo Puedes abrir los archivos generados en "3D CAD Sketcher".
pause

@echo off
chcp 65001 > nul
title VOXEL3D CAD - Asistente de Publicación en Internet

echo ===================================================================
echo               VOXEL3D CAD - PUBLICACIÓN EN INTERNET
echo ===================================================================
echo.
echo Selecciona la opción que deseas ejecutar:
echo.
echo [1] Iniciar Servidor de Producción (Node.js + Express)
echo     - Compila el frontend optimizado en /dist y levanta el servidor
echo.
echo [2] Generar Enlace Público Instantáneo (Túnel HTTPS Cloudflare)
echo     - Abre un enlace web seguro https://*.trycloudflare.com accesible
echo       desde cualquier lugar del mundo (móvil, otros ordenadores, etc.)
echo.
echo [3] Preparar y desplegar 24/7 en la nube (Render / Railway / Docker)
echo     - Muestra las instrucciones para subir a GitHub y desplegar gratis
echo.
echo [4] Salir
echo.
echo ===================================================================
set /p opt="Elige una opción (1-4): "

if "%opt%"=="1" goto OP_PROD
if "%opt%"=="2" goto OP_TUNNEL
if "%opt%"=="3" goto OP_CLOUD
if "%opt%"=="4" goto FIN

:OP_PROD
echo.
echo [INFO] Compilando frontend para producción con Vite...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] La compilación falló. Revisa los errores arriba.
    pause
    goto FIN
)
echo.
echo [INFO] Iniciando servidor de producción Express...
call npm start
goto FIN

:OP_TUNNEL
echo.
echo ===================================================================
echo [INFO] Creando túnel público HTTPS seguro con Cloudflare...
echo       (Asegúrate de que la aplicación esté corriendo en el puerto 3000)
echo ===================================================================
echo.
npx -y untun tunnel --port 3000
pause
goto FIN

:OP_CLOUD
echo.
echo ===================================================================
echo          GUÍA DE DESPLIEGUE EN LA NUBE 24/7 (RENDER / RAILWAY)
echo ===================================================================
echo.
echo PASO 1: Sube este proyecto a tu cuenta de GitHub:
echo         git add .
echo         git commit -m "Preparar producción VOXEL3D CAD"
echo         git push origin main
echo.
echo PASO 2: Entra en https://dashboard.render.com/ (o https://railway.app/)
echo.
echo PASO 3: Crea un nuevo "Web Service" y conecta tu repositorio de GitHub.
echo.
echo PASO 4: Render detectará automáticamente el archivo 'render.yaml' o 'Dockerfile'.
echo         - Build Command: npm install --legacy-peer-deps && npm run build
echo         - Start Command: npm start
echo         - Health Check Path: /api/health
echo.
echo PASO 5: ¡Listo! Render te proporcionará tu URL pública permanente HTTPS,
echo         por ejemplo: https://voxel3d-cad.onrender.com
echo.
pause
goto FIN

:FIN
echo.
echo Saliendo del asistente.

# Guía Completa de Publicación en Internet — VOXEL3D CAD

Esta guía detalla los métodos disponibles para publicar la plataforma **VOXEL3D CAD** en Internet con acceso público y seguro (HTTPS), permitiendo a cualquier usuario abrir la aplicación desde cualquier ordenador, tablet o teléfono móvil.

---

## 🏗️ 1. Arquitectura de Producción

La plataforma consta de:
- **Frontend SPA (Vite + React 19 + Three.js + TailwindCSS):** Se compila en la carpeta `dist/` optimizada para carga ultra rápida.
- **Motor WebAssembly OpenCASCADE (`occt-import-js.wasm`):** Procesa archivos STEP en el navegador del cliente a través de Web Workers.
- **Backend de Producción (`server/production_server.ts`):** Servidor Express que sirve los archivos estáticos y las 4 APIs:
  - `/api/projects`: Guardado y compartición de modelos en la nube.
  - `/api/convert-step`: Subida y conversión de ensamblajes STEP.
  - `/api/step-split`: Procesamiento y división de archivos STEP pesados.
  - `/api/reconstruct`: Reconstrucción asistida por IA mediante Gemini.
  - `/api/health`: Health-check para balanceadores de carga en la nube.

---

## ⚡ Método 1: Enlace Público Instantáneo (1 Minuto, Sin Configuración)

Si quieres compartir la aplicación **ahora mismo** con un cliente, compañero o probarla en tu móvil sin tener que registrarte en servicios de nube ni configurar servidores:

### Pasos:
1. Haz doble clic en el archivo [publicar_en_internet.bat](file:///c:/Users/jvargasv/antigravity/3D-CAD-Sketcher-&-Extruder/publicar_en_internet.bat) y selecciona la **Opción 2**.
   *(O ejecuta en la terminal: `npx untun tunnel --port 3000`)*
2. Cloudflare creará inmediatamente un túnel seguro HTTPS con una dirección pública como:
   `https://random-word-abc.trycloudflare.com`
3. Copia ese enlace y envíalo a quien quieras: podrán usar el modelador 3D, guardar diseños y cargar archivos STEP desde cualquier lugar del mundo.

---

## ☁️ Método 2: Despliegue 24/7 en la Nube con Render.com (Recomendado)

[Render.com](https://render.com/) ofrece alojamiento gratuito para aplicaciones Node.js con certificados SSL automáticos y despliegue continuo desde GitHub.

### Pasos para desplegar:

1. **Subir el código a GitHub:**
   Abre una terminal en la carpeta del proyecto y sube los cambios:
   ```bash
   git add .
   git commit -m "Preparar servidor de producción para publicación web"
   git push origin main
   ```

2. **Crear el servicio en Render:**
   - Inicia sesión en [dashboard.render.com](https://dashboard.render.com/).
   - Pulsa en **`New +`** y selecciona **`Web Service`**.
   - Conecta tu repositorio de GitHub `3D-CAD-Sketcher-&-Extruder`.

3. **Configuración del Servicio:**
   *(Render detectará automáticamente el archivo [render.yaml](file:///c:/Users/jvargasv/antigravity/3D-CAD-Sketcher-&-Extruder/render.yaml), pero si lo configuras manualmente, estos son los valores:)*
   - **Name:** `voxel3d-cad` (o el nombre que elijas)
   - **Environment:** `Node`
   - **Build Command:** `npm install --legacy-peer-deps && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** `Free`

4. **Variables de Entorno (Opcional):**
   En la pestaña **Environment**, puedes añadir:
   - `GEMINI_API_KEY`: Tu clave API de Google AI Studio (si vas a usar la función de reconstrucción con IA).

5. **Despliegue completado:**
   En pocos minutos, Render te proporcionará tu URL pública permanente, como:
   `https://voxel3d-cad.onrender.com`

---

## 🐳 Método 3: Despliegue con Contenedor Docker (Railway / Fly.io / VPS)

El repositorio incluye un [Dockerfile](file:///c:/Users/jvargasv/antigravity/3D-CAD-Sketcher-&-Extruder/Dockerfile) optimizado que instala Node.js 20 y Python 3 en un contenedor ligero Debian.

### En Railway.app:
1. Entra en [railway.app](https://railway.app/).
2. Haz clic en **`New Project`** -> **`Deploy from GitHub repo`**.
3. Selecciona tu repositorio: Railway detectará el `Dockerfile` y construirá la aplicación automáticamente.
4. En **Settings** -> **Networking**, haz clic en **`Generate Domain`** para obtener tu enlace público HTTPS.

### En un Servidor VPS propio (Ubuntu / Debian):
```bash
# 1. Clonar el repositorio
git clone <tu-url-de-github>
cd 3D-CAD-Sketcher-&-Extruder

# 2. Construir la imagen Docker
docker build -t voxel3d-cad .

# 3. Ejecutar el contenedor en segundo plano en el puerto 80/443
docker run -d --name voxel3d -p 3000:3000 --restart always voxel3d-cad
```

---

## 🧪 Verificación Local del Servidor de Producción

Antes de publicar, puedes probar el servidor de producción exactamente como correrá en la nube:

1. Compila la aplicación:
   ```bash
   npm run build
   ```
2. Inicia el servidor de producción:
   ```bash
   npm start
   ```
3. Accede a `http://localhost:3000/` en tu navegador.
4. Verifica el estado del servidor en `http://localhost:3000/api/health`.

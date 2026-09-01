# 3D CAD Sketcher & Extruder (AI-Assisted)

Aplicación CAD paramétrica interactiva en el navegador que permite bocetar perfiles 2D con precisión milimétrica, extruir y revolucionar sólidos a 3D, aplicar chaflanes/redondeos, realizar operaciones booleanas (unir, cortar, intersecar), importar y ensamblar múltiples archivos STEP/STL/OBJ en un mismo entorno de trabajo, y exportar a STEP (ISO 10303-21) y STL. Incluye asistencia de IA para reconstruir modelos 3D y bocetos paramétricos a partir de imágenes o texto.

---

## ✨ Características Principales

- **📐 Boceto 2D Paramétrico en Cualquier Plano:**
  - Dibujo de líneas, rectángulos, círculos, triángulos y polígonos sobre planos estándar (XY, XZ, YZ) o directamente sobre caras existentes de modelos 3D.
  - Medición en tiempo real (longitud $L$, ángulo $\angle$, dimensiones $W \times H$, radio $R$ y diámetro $\varnothing$).
  - Sistema de captura y restricciones (Object Snaps: vértices, puntos medios, centros, cuadrícula e intersecciones).
  - Herramientas de edición 2D: Seleccionar, Recortar segmentos (*Trim*), Borrador (*Erase* / `Supr`), Espejo (*Mirror*) y Patrones lineales/circulares.

- **📦 Modelado Sólido 3D & Operaciones Booleanas:**
  - **Extrusión** (con soporte para ángulos de inclinación/taper) y **Revolución 360°** alrededor de ejes libres o aristas.
  - **Constructive Solid Geometry (CSG):** Unión (*Join*), Corte (*Cut*) e Intersección entre sólidos y piezas importadas.
  - **Chaflanes y Redondeos:** Soporte para filetes circulares y cortes de alivio CNC (*Dog-bone / V-notch*) en esquinas y agujeros internos.

- **🔄 Importación / Exportación CAD Industrial:**
  - **Multi-Importación:** Carga y ensamblaje de múltiples archivos STEP (`.step`, `.stp`), STL y OBJ en el mismo espacio de trabajo.
  - **Panel de Transformación 3D:** Mover en $X, Y, Z$, rotar en grados y escalar piezas y ensamblajes importados.
  - **Exportación:** Exportador nativo a formato STEP estandarizado (ISO 10303-21), STL binario/ASCII y Wavefront OBJ.

- **🤖 Reconstrucción Asistida por IA (Gemini):**
  - **CAD Paramétrico (IA):** Genera bocetos 2D con cotas y extrusiones editables a partir de bocetos a mano o fotos de piezas mecánicas.
  - **Malla 3D (IA):** Genera mallas Wavefront OBJ cerradas (*watertight*) listas para visualización y exportación.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Frontend UI** | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS 4](https://tailwindcss.com/), [Lucide Icons](https://lucide.dev/), [Motion](https://motion.dev/) |
| **Motor 3D & Render** | [Three.js](https://threejs.org/) (WebGL B-Rep & PBR Materials, OrbitControls) |
| **Geometría & Sólidos** | [three-csg-ts](https://github.com/samalexander/three-csg-ts) (CSG Booleans), [polygon-clipping](https://github.com/mfogel/polygon-clipping), [martinez-polygon-clipping](https://github.com/w8r/martinez) |
| **Procesamiento STEP / CAD** | [occt-import-js](https://github.com/kovacsv/occt-import-js) (OpenCASCADE WebAssembly Worker en cliente) + Servidor OpenCASCADE 64-bit para modelos masivos |
| **Inteligencia Artificial** | Google Gemini API (Proxy seguro en backend con `gemini-2.5-flash` y `gemini-2.0-flash`) |
| **Herramienta de Build** | [Vite 6](https://vitejs.dev/) |

---

## 🚀 Instalación y Ejecución Local

### 1. Requisitos Previos:
- **Node.js**: Versión 18.0 o superior ([Descargar Node.js](https://nodejs.org/)).
- **Python 3.10+** *(opcional)*: Solo necesario si deseas habilitar el motor OpenCASCADE nativo en backend para procesar archivos STEP de más de 25 MB (`cadquery` o `OCP` vía pip). Para archivos STEP normales (<25MB), el visor utiliza el motor WebAssembly integrado directamente en el navegador.

### 2. Pasos de Instalación:

1. **Clonar el repositorio:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd 3D-CAD-Sketcher-&-Extruder
   ```

2. **Instalar dependencias de Node:**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno:**
   Copia el archivo de ejemplo `.env.example` a `.env`:
   ```bash
   cp .env.example .env
   ```
   Abre `.env` y añade tu clave API de [Google AI Studio](https://aistudio.google.com/):
   ```env
   GEMINI_API_KEY=tu_clave_gemini_aqui
   ```

4. **Iniciar el servidor de desarrollo:**
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

5. **Compilar para producción:**
   ```bash
   npm run build
   ```

---

## 🔒 Seguridad y Privacidad

> [!IMPORTANT]
> **La clave `GEMINI_API_KEY` NUNCA se expone en el cliente web.**
> Todas las llamadas generativas y de análisis visual se gestionan a través de los endpoints de backend (`/api/reconstruct`, `/api/convert-step`), garantizando que tus credenciales permanezcan seguras en el servidor local.

---

## 📸 Documentación y Capturas

Puedes consultar diagramas y figuras demostrativas del flujo de modelado en la carpeta [`docs/`](docs/):
- `docs/book.png` - Flujo de diseño paramétrico y visualización de bocetos.
- `docs/soporte.jpeg` - Ejemplo de modelado, chaflanes y ensamble de piezas mecánicas.

---

## 📄 Licencia

Este proyecto está bajo la licencia **Apache 2.0** — consulta el archivo [`LICENSE`](LICENSE) para más detalles.

### Reconocimientos a librerías de terceros:
- **OpenCASCADE / occt-import-js:** Distribuido bajo licencia LGPL-2.1 / OpenCASCADE Technology Public License.
- **Three.js:** Distribuido bajo licencia MIT.
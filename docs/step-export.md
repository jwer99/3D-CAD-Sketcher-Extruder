# Exportación STEP

El servidor necesita `python` con las dependencias de `server/requirements.txt`:

```sh
python -m pip install -r server/requirements.txt
npm run test:step
```

El Dockerfile instala este motor. Un despliegue con el entorno Node de
`render.yaml` debe instalar también esas dependencias en el Python que ejecuta
el servidor. Sin el motor, la aplicación descarga el STEP de malla e informa
de que conserva triangulación.

Las extrusiones rectas sin bisel conservan una descripción CAD en la geometría
del visor. Los círculos completos se recuperan de los perfiles originales;
los polígonos recortados conservan sus puntos. Cada corte, unión o intersección
confirmado combina las descripciones de sus dos operandos y conserva sus
transformaciones. La exportación reconstruye ese árbol con OpenCASCADE, sin
inferir operaciones a partir de un historial que pueda no coincidir con la
escena visible. Los proyectos existentes regeneran esta información al abrirse.

Las revoluciones, biseles, conicidades y piezas importadas que solo conservan
una malla utilizan la ruta de cosido y unificación de caras coplanares. No se
ajustan cilindros inventados a esas mallas; sus curvas pueden seguir facetadas.
La aplicación informa cuando un STEP incluye piezas de esta ruta.

La limpieza se acepta si el resultado es válido y conserva el volumen dentro
de la tolerancia. El modelo editable no se modifica. STL y OBJ siguen siendo
exportaciones de malla.

Las pruebas vuelven a leer los archivos STEP con OpenCASCADE y comprueban
validez, volumen, seis planos y tres cilindros en un bloque con taladros en
dos direcciones; también cubren mallas planas y extrusiones negativas huecas.

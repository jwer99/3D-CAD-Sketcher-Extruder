# Activar la primera vía de ingresos

Implementado: página `/servicios`, acceso desde el editor sin cerrar el trabajo actual,
consulta por correo y enlace a aportaciones voluntarias. El editor continúa gratuito.
No hay suscripciones, licencias PRO, verificación de pagos ni pedidos automáticos.

## Configuración pendiente del titular

En el servicio existente de Render, añadir estas variables de entorno:

```env
SALES_EMAIL=juandedofeliz@gmail.com
SUPPORT_PAYMENT_URL=https://www.paypal.me/jwer99
```

Ambos datos serán públicos. No introducir contraseñas ni claves API.
El correo comercial facilitado por el titular (`juandedofeliz@gmail.com`) está
configurado por defecto. `SALES_EMAIL` permite sustituirlo o desactivarlo con un
valor vacío. Las consultas abren el correo del visitante y requieren que este
envíe el mensaje; no se envía correo automáticamente desde el servidor.
El enlace público facilitado por el titular (`https://www.paypal.me/jwer99`) está
configurado por defecto. La variable permite sustituirlo; un valor vacío desactiva
las aportaciones.
Se admiten enlaces de `paypal.me`, `www.paypal.me` y `www.paypal.com`, además de los proveedores
indicados en `server/commerce.ts`. Un enlace inexistente o de otro dominio se oculta.
Para el botón de apoyo, elegir un enlace de aportación cuyo importe y condiciones
se muestren claramente en PayPal; no reutilizar un enlace para otro producto.
Sin configurar el correo no se pueden enviar consultas; con el enlace desactivado no se muestran
botones de pago activos. No se simulan pagos ni consultas recibidas.

Publicar los cambios revisados en el repositorio conectado a Render y desplegar.
El proyecto tenía cambios locales anteriores: revisarlos por separado antes de
incluirlos en una publicación. No subir `.env`, modelos guardados ni credenciales.
Comprobar `/api/commerce` y `/servicios` tras el despliegue. Reiniciar el servicio
al cambiar variables; no es necesario recompilar el frontend por esos valores.

## Oferta inicial a validar

Vender trabajo CAD concreto por presupuesto: una pieza sencilla desde un croquis
acotado, adaptación de una pieza o conversión de formato. Confirmar que el titular
puede prestar cada servicio antes de promoverlo. No prometer plazos ni resultados
de fabricación sin revisar la geometría y las necesidades del cliente.

Propuesta de experimento (no tarifas publicadas): probar presupuestos de 49–99 €
por una pieza sencilla, ajustados a horas reales, revisiones y costes. Acordar por
escrito alcance, entrega, precio final y condiciones antes de cobrar. Cobrar los
encargos mediante una solicitud comercial específica en PayPal; una aportación
voluntaria no compra trabajo de modelado.

## Conseguir los primeros clientes

1. Preparar tres demostraciones propias: soporte en L, adaptador y pieza de repuesto,
   mostrando croquis, modelo y archivo exportado. No usar archivos de clientes.
2. Publicar una demostración con el enlace `/servicios` en canales propios y en
   comunidades de impresión 3D que permitan promoción. Las publicaciones y mensajes
   requieren que el titular los revise y autorice; no se han enviado.
3. Ofrecer un alcance pequeño y verificable, responder a cada consulta y registrar
   manualmente origen, presupuesto, aceptación, ingreso y horas de trabajo.
4. Revisar tras las primeras diez consultas: tasa de aceptación, margen por hora y
   motivos de rechazo. Ajustar la oferta antes de invertir en publicidad.

Texto base para una publicación del titular:

> He creado VOXEL3D, un editor CAD para bocetar y extruir piezas en el navegador.
> Puedes probarlo gratis. Si necesitas ayuda con una pieza concreta, describe sus
> medidas y el formato que necesitas para consultar disponibilidad y presupuesto:
> https://threed-cad-sketcher-extruder.onrender.com/servicios

No se ha contratado publicidad, contactado clientes ni registrado ingresos.

## Verificación local

```sh
npm run lint
node node_modules/tsx/dist/cli.mjs tests/commerce.test.ts
npm run build
```

Revisar también el estado sin configuración y con un enlace real, la apertura
del correo, navegación al editor y presentación en móvil. No enviar un pago de
prueba real desde el botón sin decisión expresa del titular.

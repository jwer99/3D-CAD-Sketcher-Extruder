# Implementation Plan: Inner Corner Chamfer Logic

## Goal Description
El usuario ha detectado que cuando se aplica un "Chaflán" a las esquinas de un agujero (un rectángulo dentro de otro), el sistema añade material sólido (un triángulo naranja) en lugar de quitarlo. El usuario espera que el chaflán "entienda que es un hueco" y, por tanto, expanda el agujero hacia el sólido (quitando material).

## Análisis Geométrico
Matemáticamente, en 2D, si cortas la esquina de un polígono, la línea siempre queda por el interior del polígono.
- Si el polígono es una pieza sólida, cortar la esquina **quita** material (correcto).
- Si el polígono representa un agujero, cortar la esquina hace el agujero más pequeño, lo que **añade** material sólido (el triángulo naranja que ves).

Para que un chaflán en la esquina de un agujero **quite material del sólido** (haciendo el agujero más grande), la única forma geométrica sin mover todas las paredes es crear un corte de alivio hacia afuera, conocido en mecanizado CNC como **"V-Notch" o "Dog-bone chamfer"**. Esto empuja la esquina hacia el sólido en forma de 'V', garantizando que una pieza cuadrada perfecta pueda encajar en el agujero.

Por el contrario, el "Redondeado" actual te funciona bien porque emula físicamente el material que deja una fresa redonda (CNC) al intentar cortar una esquina cuadrada (haciendo el agujero más pequeño y dejando material en el vértice).

## Proposed Changes
Modificar la lógica en `GeometryUtils.ts` para que, cuando detectemos que estamos aplicando un chaflán a un agujero (`isHole === true`), invirtamos la dirección del corte creando un "V-notch" (corte de alivio hacia el sólido).

### GeometryUtils.ts
- [MODIFY] En `getStyledPoints`, si `style.type === "chamfer"` y `isHole` es verdadero, en lugar de empujar `p1` y `p2`, generaremos un tercer punto `p_bone` proyectado hacia el exterior de la esquina (hacia el sólido).
- La ruta será `p1 -> p_bone -> p2`, creando un corte en 'V' que remueve el material de la esquina del sólido.

## User Review Required
> [!IMPORTANT]
> **Pregunta para el usuario:**
> Al implementar esta lógica, el chaflán en un agujero creará una pequeña muesca en forma de 'V' hacia el sólido (un corte de alivio) para poder quitar material sin romper las paredes rectas del agujero. ¿Es este el resultado exacto que buscas para que se comporte como un "hueco creado"? (Si prefieres que simplemente no haga nada en agujeros para evitar errores, házmelo saber. El Redondeado lo dejaremos igual ya que confirmas que es el comportamiento deseado).

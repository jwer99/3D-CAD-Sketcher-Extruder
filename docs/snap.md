# Capturas de boceto

En modo boceto, la flecha junto a **Snap ON** abre las ayudas. **F3** pausa o activa la captura sin borrar la selección. Las preferencias se conservan en este navegador.

La opción **Usar piezas anteriores proyectadas en este plano** utiliza aristas de los sólidos visibles y las secciones del plano. Los contornos violetas son referencias; no añaden geometría al boceto. Se respetan las transformaciones de la pieza. El sólido generado por el propio boceto activo queda excluido para evitar capturas sobre sí mismo.

- Extremos, puntos medios, centros de contornos cerrados y cuadrantes de círculos reconocidos.
- Intersecciones entre aristas rectas proyectadas; no son necesariamente encuentros físicos en 3D.
- Punto más cercano a aristas y círculos.
- Perpendicular y paralela desde el último punto del trazo.
- Tangentes desde un punto exterior a círculos del boceto o círculos reconocidos en la proyección.
- Alineación horizontal/vertical, simetría respecto a los ejes y cuadrícula configurable.

El radio se ajusta en píxeles y se adapta al zoom. Las capturas a puntos tienen prioridad frente al punto más cercano y la paralela. La etiqueta junto al cursor indica la ayuda usada. Al mover un vértice, su propio perfil se excluye de las capturas.

Las referencias de sólidos proceden de su geometría de visualización: su precisión depende de la malla. El reconocimiento circular exige un contorno cerrado circular; no convierte elipses ni curvas arbitrarias en círculos. Los planos del editor continúan siendo XY, XZ e YZ con desplazamiento. Estas ayudas no crean restricciones paramétricas asociativas.

Verificación: `npm run test:snap`, `npm run lint` y `npm run build`.

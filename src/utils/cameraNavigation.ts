import { MOUSE } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Changing edit mode must never move the camera or its orbit target. */
export function configureCadNavigation(controls: OrbitControls, sketchMode: boolean) {
  controls.mouseButtons = {
    LEFT: sketchMode ? -1 as MOUSE : MOUSE.ROTATE,
    MIDDLE: MOUSE.ROTATE,
    RIGHT: MOUSE.PAN,
  };
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
}

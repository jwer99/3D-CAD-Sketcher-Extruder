import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { configureCadNavigation } from '../src/utils/cameraNavigation';

// Exercise real OrbitControls events without a GPU or browser.
class Canvas extends EventTarget {
  style = {};
  ownerDocument = new EventTarget();
  clientWidth = 1000;
  clientHeight = 800;
  getRootNode() { return this.ownerDocument; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 800 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}
const event = (type: string, values: object) => Object.assign(new Event(type, { cancelable: true }), values);
for (const sketchMode of [false, true]) {
  const canvas = new Canvas();
  const camera = new PerspectiveCamera(50, 1.25, 0.1, 50000);
  camera.position.set(0, 0, 100);
  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  configureCadNavigation(controls, sketchMode);
  const drag = (button: number, endX: number, endY: number) => {
    const pointer = { pointerId: 1, pointerType: 'mouse', button, clientX: 500, clientY: 400, pageX: 500, pageY: 400 };
    canvas.dispatchEvent(event('pointerdown', pointer));
    canvas.ownerDocument.dispatchEvent(event('pointermove', { ...pointer, clientX: endX, clientY: endY, pageX: endX, pageY: endY }));
    canvas.ownerDocument.dispatchEvent(event('pointerup', pointer));
  };
  const before = camera.position.clone();
  drag(2, 1500, 400);
  assert.ok(controls.target.length() > 100, 'Right drag pans freely beyond sketch origin');
  assert.ok(camera.position.clone().sub(before).distanceTo(controls.target) < 1e-8, 'Pan translates camera and target equally');
  const target = controls.target.clone(), orbitBefore = camera.position.clone();
  drag(1, 600, 450);
  assert.ok(camera.position.distanceTo(orbitBefore) > 1, 'Middle drag orbits in both modes');
  assert.ok(controls.target.distanceTo(target) < 1e-8, 'Orbit preserves the panned target');
  const position = camera.position.clone();
  configureCadNavigation(controls, !sketchMode);
  assert.ok(camera.position.equals(position) && controls.target.equals(target), 'Mode switch preserves framing');
  camera.position.set(0, 0, 100); controls.target.set(0, 0, 0); controls.update();
  camera.updateMatrixWorld();
  const ndc = new Vector3(0.5, 0.25, 0.5).unproject(camera);
  const ray = ndc.sub(camera.position).normalize();
  const anchor = camera.position.clone().addScaledVector(ray, -camera.position.z / ray.z);
  const screen = anchor.clone().project(camera);
  for (const deltaY of [-120, 120]) {
    canvas.dispatchEvent(event('wheel', { clientX: 750, clientY: 300, deltaY, deltaMode: 0, ctrlKey: false }));
    camera.updateMatrixWorld();
    const after = anchor.clone().project(camera);
    assert.ok(Math.hypot(after.x - screen.x, after.y - screen.y) < 1e-8, 'Zoom in and out preserve the point under the cursor');
  }
  controls.dispose();
}
console.log('Camera navigation: pan, orbit, mode continuity and cursor zoom passed.');

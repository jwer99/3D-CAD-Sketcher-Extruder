import assert from 'node:assert/strict';
import { BoxGeometry, BufferGeometry, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { CSG } from 'three-csg-ts';
import { solidEdges } from '../src/utils/solidEdges';

const box = new BoxGeometry(10, 10, 10);
assert.equal(solidEdges(box).getAttribute('position').count, 24, 'Preserve all twelve box edges');
// A planar rectangle with a T junction on the shared diagonal.
const plane = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([
  0,0,0, 2,0,0, 0,2,0,
  2,0,0, 2,2,0, 1,1,0,
  2,2,0, 0,2,0, 1,1,0,
], 3));
assert.equal(solidEdges(plane).getAttribute('position').count, 8, 'Only the four outer boundaries remain');

const cutter = new Mesh(new CylinderGeometry(2, 2, 14, 48));
cutter.updateMatrix();
const body = new Mesh(box);
body.updateMatrix();
const cut = CSG.subtract(body, cutter).geometry;
const before = Array.from(cut.getAttribute('position').array);
const outline = solidEdges(cut).getAttribute('position');
const rawCount = new EdgesGeometry(cut, 35).getAttribute('position').count;
assert.ok(outline.count < rawCount, 'Remove CSG triangulation artifacts');
for (let i = 0; i < outline.count; i += 2) {
  const a = new Vector3().fromBufferAttribute(outline, i);
  const b = new Vector3().fromBufferAttribute(outline, i + 1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const boxBoundary = [mid.x, mid.y, mid.z].filter(v => Math.abs(Math.abs(v) - 5) < 1e-3).length >= 2;
  const holeRim = Math.abs(Math.abs(mid.y) - 5) < 1e-3 && Math.abs(Math.hypot(mid.x, mid.z) - 2) < 0.01;
  assert.ok(boxBoundary || holeRim, `Unexpected internal edge at ${mid.toArray()}`);
}
assert.deepEqual(Array.from(cut.getAttribute('position').array), before, 'Do not alter editing/export geometry');
console.log('Solid edge regression tests passed');

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { BoxGeometry, Mesh, Matrix4 } from 'three';
import { getSolidRegions } from '../src/GeometryUtils';
import { booleanStepRecipe, extrusionRecipe, worldStepRecipe } from '../src/utils/stepRecipe';
import type { Profile, SketchData } from '../src/types';

const rectangle: Profile = { id: 'box', type: 'rectangle', isClosed: true,
  points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] };
function sketch(profiles: Profile[], plane: SketchData['plane'] = 'XZ'): SketchData {
  return { id: 'sketch', name: 'Test', profiles, plane };
}
function circle(x: number, y: number): Profile {
  return { id: 'circle', type: 'circle', isClosed: true, center: { x, y }, radius: 2,
    points: Array.from({ length: 48 }, (_, i) => ({ x: x + 2 * Math.cos(i * Math.PI / 24), y: y + 2 * Math.sin(i * Math.PI / 24) })) };
}
function nativeMesh(s: SketchData, height: number): Mesh {
  const mesh = new Mesh(new BoxGeometry());
  mesh.geometry.userData.stepRecipe = extrusionRecipe(getSolidRegions(s), s, { height, bevelType: 'none' });
  assert.ok(mesh.geometry.userData.stepRecipe);
  return mesh;
}
const baseSketch = sketch([rectangle]);
assert.equal(extrusionRecipe(getSolidRegions(baseSketch), baseSketch, { height: 20, bevelType: 'fillet' }), undefined);
assert.equal(extrusionRecipe(getSolidRegions(baseSketch), baseSketch, { height: 20, bevelType: 'none', taperScale: 0.5 }), undefined);
const body = nativeMesh(baseSketch, 20);
for (const x of [-5, 5]) {
  const tool = nativeMesh(sketch([circle(x, -5)]), 22);
  assert.ok(JSON.stringify(worldStepRecipe(tool)).includes('"radius":2'), 'Recover full original circle after region extraction');
  tool.position.z = -1;
  body.geometry.userData.stepRecipe = booleanStepRecipe(body, tool, 'cut');
}
const crossTool = nativeMesh(sketch([circle(10, 5)], 'YZ'), 22);
crossTool.position.x = 11;
body.geometry.userData.stepRecipe = booleanStepRecipe(body, crossTool, 'cut');
const recipe = worldStepRecipe(body);
assert.ok(recipe);
assert.equal(booleanStepRecipe(body, new Mesh(new BoxGeometry()), 'join'), undefined, 'Unknown meshes must not get incomplete recipes');
// World placement must follow the mesh, including inherited parent transforms.
const moved = nativeMesh(baseSketch, -20);
moved.applyMatrix4(new Matrix4().makeTranslation(30, 40, 50));
assert.equal(worldStepRecipe(moved)!.kind, 'transform');

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ parts: [
  { name: 'Bloque con tres taladros', color: [0.2, 0.5, 0.8], recipe },
] }));
console.log('STEP recipe regression tests passed');

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PRESET_MATERIALS, MaterialStyle, ImportedBody } from '../src/types';

console.log('🧪 Testing Material Palette presets and mesh synchronization...');

// 1. Validate all presets have valid definitions
assert.ok(PRESET_MATERIALS.length >= 6, 'Should have at least 6 material presets');

for (const preset of PRESET_MATERIALS) {
  assert.ok(preset.id && preset.id.length > 0, `Preset ${preset.name} must have a non-empty id`);
  assert.ok(preset.name && preset.name.length > 0, `Preset ${preset.id} must have a non-empty name`);
  assert.ok(preset.roughness >= 0 && preset.roughness <= 1, `Roughness for ${preset.name} must be within [0, 1]`);
  assert.ok(preset.metalness >= 0 && preset.metalness <= 1, `Metalness for ${preset.name} must be within [0, 1]`);
  assert.ok(preset.opacity > 0 && preset.opacity <= 1, `Opacity for ${preset.name} must be within (0, 1]`);

  // Verify THREE.Color parses the hex color
  const color = new THREE.Color(preset.color);
  assert.ok(!isNaN(color.r) && !isNaN(color.g) && !isNaN(color.b), `Color for ${preset.name} (${preset.color}) must be a valid color`);
}

// 2. Test applying material preset to solid meshes
const solidGroup = new THREE.Group();
const mesh1 = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: 0x52525b }));
mesh1.userData = { type: 'solid', solidId: 'op-1' };
solidGroup.add(mesh1);

const mesh2 = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 20), new THREE.MeshStandardMaterial({ color: 0x52525b }));
mesh2.userData = { type: 'solid', solidId: 'op-2' };
solidGroup.add(mesh2);

const goldPreset = PRESET_MATERIALS.find(p => p.id === 'gold')!;
assert.ok(goldPreset, 'Gold preset should exist');

const goldColor = new THREE.Color(goldPreset.color);
solidGroup.traverse((child) => {
  if (child instanceof THREE.Mesh && child.userData?.type === 'solid') {
    if (child.material instanceof THREE.MeshStandardMaterial) {
      child.material.color.copy(goldColor);
      child.material.roughness = goldPreset.roughness;
      child.material.metalness = goldPreset.metalness;
      child.material.needsUpdate = true;
    }
  }
});

assert.strictEqual(
  (mesh1.material as THREE.MeshStandardMaterial).color.getHexString().toLowerCase(),
  goldColor.getHexString().toLowerCase(),
  'Mesh 1 should now have gold color'
);
assert.strictEqual(
  (mesh1.material as THREE.MeshStandardMaterial).roughness,
  goldPreset.roughness,
  'Mesh 1 should now have gold roughness'
);
assert.strictEqual(
  (mesh2.material as THREE.MeshStandardMaterial).metalness,
  goldPreset.metalness,
  'Mesh 2 should now have gold metalness'
);

// 3. Test applying material to selected imported bodies
const importedBodies: ImportedBody[] = [
  { id: 'part-1', name: 'Body 1', vertices: new Float32Array(0), color: [0.5, 0.5, 0.5] },
  { id: 'part-2', name: 'Body 2', vertices: new Float32Array(0), color: [0.3, 0.3, 0.3] }
];

const selectedIds = new Set(['part-1']);
const bluePreset = PRESET_MATERIALS.find(p => p.id === 'anodized-blue')!;
const blueColor = new THREE.Color(bluePreset.color);

const updatedBodies = importedBodies.map(b => {
  if (selectedIds.has(b.id)) {
    return {
      ...b,
      color: [blueColor.r, blueColor.g, blueColor.b] as [number, number, number]
    };
  }
  return b;
});

assert.deepStrictEqual(
  updatedBodies[0].color,
  [blueColor.r, blueColor.g, blueColor.b],
  'Part 1 should have updated blue color'
);
assert.deepStrictEqual(
  updatedBodies[1].color,
  [0.3, 0.3, 0.3],
  'Part 2 should keep original color when not selected'
);

console.log('✓ All Material Palette tests passed successfully!');

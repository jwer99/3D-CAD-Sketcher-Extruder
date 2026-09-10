import assert from 'node:assert/strict';
import { pickSketchProfile } from '../src/utils/sketchSelection';
import { formatMeasurement } from '../src/components/MeasurementInput';
import type { Profile } from '../src/types';

for (const type of ['rectangle', 'circle', 'triangle', 'hexagon', 'polygon'] as const) {
  const count = type === 'rectangle' ? 4 : type === 'triangle' ? 3 : type === 'hexagon' ? 6 : 36;
  const profile: Profile = { id: type, type, isClosed: true, points: Array.from({ length: count }, (_, i) => ({ x: 50 * Math.cos(i * 2 * Math.PI / count), y: 50 * Math.sin(i * 2 * Math.PI / count) })) };
  assert.equal(pickSketchProfile([profile], { x: 0, y: 0 })?.id, type, `${type}: interior`);
  assert.equal(pickSketchProfile([profile], profile.points[0])?.id, type, `${type}: outline`);
  assert.equal(pickSketchProfile([profile], { x: 100, y: 100 }), undefined);
  assert.equal(pickSketchProfile([profile, { ...profile, id: 'last' }], { x: 0, y: 0 })?.id, 'last');
}
const open: Profile = { id: 'line', type: 'polygon', isClosed: false, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] };
assert.equal(pickSketchProfile([open], { x: 25, y: 25 }), undefined, 'Do not select the imaginary closing edge of an open line');
assert.equal(pickSketchProfile([open], { x: 25, y: 0 })?.id, 'line');
assert.equal(formatMeasurement(12.123456789), '12.123');
assert.equal(formatMeasurement(-0.00000001), '0');
assert.equal(formatMeasurement(10), '10');
assert.equal(formatMeasurement(Infinity), '');
console.log('Sketch selection and measurement formatting checks passed.');

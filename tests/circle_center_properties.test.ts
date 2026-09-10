import assert from 'node:assert/strict';
import type { Profile, Point2D, SketchData } from '../src/types';
import { formatMeasurement } from '../src/components/MeasurementInput';

// Test 1: Circle center update logic
const initialCenter: Point2D = { x: 10, y: 20 };
const radius = 15;
const initialPoints: Point2D[] = [];
for (let i = 0; i < 36; i++) {
  const angle = (i / 36) * Math.PI * 2;
  initialPoints.push({
    x: initialCenter.x + Math.cos(angle) * radius,
    y: initialCenter.y + Math.sin(angle) * radius
  });
}

const circleProfile: Profile = {
  id: 'circle-1',
  type: 'circle',
  points: initialPoints,
  center: initialCenter,
  radius,
  isClosed: true
};

const sketch: SketchData = {
  id: 'sketch-1',
  name: 'Sketch Test',
  plane: 'XY',
  profiles: [circleProfile]
};

// Simulate moving center to (-25, 45.5)
const targetX = -25;
const targetY = 45.5;

const updatedPoints: Point2D[] = [];
for (let i = 0; i < 36; i++) {
  const angle = (i / 36) * Math.PI * 2;
  updatedPoints.push({
    x: targetX + Math.cos(angle) * circleProfile.radius!,
    y: targetY + Math.sin(angle) * circleProfile.radius!
  });
}

const updatedCircle: Profile = {
  ...circleProfile,
  center: { x: targetX, y: targetY },
  points: updatedPoints
};

assert.equal(updatedCircle.center?.x, -25);
assert.equal(updatedCircle.center?.y, 45.5);
assert.equal(updatedCircle.radius, 15);
assert.equal(updatedCircle.points.length, 36);

// Verify all perimeter points are exactly at distance 'radius' from new center
for (const pt of updatedCircle.points) {
  const dist = Math.hypot(pt.x - updatedCircle.center!.x, pt.y - updatedCircle.center!.y);
  assert.ok(Math.abs(dist - radius) < 1e-6, `Point ${JSON.stringify(pt)} should be at radius ${radius}`);
}

// Test 2: Formatting of negative, decimal and zero coordinates
assert.equal(formatMeasurement(-25), '-25');
assert.equal(formatMeasurement(45.5), '45.5');
assert.equal(formatMeasurement(0), '0');
assert.equal(formatMeasurement(0.0001), '0');
assert.equal(formatMeasurement(12.3456), '12.346');

console.log('✅ Circle center update and geometry tests passed successfully!');

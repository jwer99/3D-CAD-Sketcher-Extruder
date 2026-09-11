import assert from 'node:assert/strict';
import {
  findSmartSnap,
  getProfileSnapCandidates,
  getBackgroundSnapCandidates,
  getSymmetryCandidates,
  OSNAPSettings
} from '../src/utils/snappingUtils';
import type { Profile } from '../src/types';

const defaultSettings: OSNAPSettings = {
  grid: true,
  vertex: true,
  midpoint: true,
  center: true,
  quadrant: true,
  symmetry: true,
  background: true,
  guides: true
};

// 1. Test Midpoint detection of a line segment
const lineProfile: Profile = {
  id: 'line1',
  type: 'polygon',
  isClosed: false,
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
};
const lineCands = getProfileSnapCandidates(lineProfile, defaultSettings);
const midpointCand = lineCands.find(c => c.type === 'midpoint');
assert.ok(midpointCand, 'Should generate midpoint candidate');
assert.equal(midpointCand.point.x, 50);
assert.equal(midpointCand.point.y, 0);

// Test snap close to midpoint
const snapMid = findSmartSnap(51, 1, [lineProfile], [], [], defaultSettings, 5, 5);
assert.equal(snapMid.type, 'midpoint');
assert.equal(snapMid.point.x, 50);
assert.equal(snapMid.point.y, 0);

// 2. Test Circle Center and Quadrants
const circleProfile: Profile = {
  id: 'circ1',
  type: 'circle',
  isClosed: true,
  center: { x: 20, y: 30 },
  radius: 15,
  points: []
};
const circleCands = getProfileSnapCandidates(circleProfile, defaultSettings);
const centerCand = circleCands.find(c => c.type === 'center');
assert.ok(centerCand, 'Should find circle center');
assert.equal(centerCand.point.x, 20);
assert.equal(centerCand.point.y, 30);

// Snap close to center
const snapCenter = findSmartSnap(21, 29, [circleProfile], [], [], defaultSettings, 5, 5);
assert.equal(snapCenter.type, 'center');
assert.equal(snapCenter.point.x, 20);
assert.equal(snapCenter.point.y, 30);

// Snap close to North quadrant (20, 45)
const snapQuad = findSmartSnap(20.5, 44.2, [circleProfile], [], [], defaultSettings, 5, 5);
assert.equal(snapQuad.type, 'quadrant');
assert.equal(snapQuad.point.x, 20);
assert.equal(snapQuad.point.y, 45);

// 3. Test Background Slice Segments (from 3D solid parts)
const bgSegments = [
  { p1: { x: -40, y: -40 }, p2: { x: 40, y: -40 } }
];
const bgCands = getBackgroundSnapCandidates(bgSegments, defaultSettings);
assert.equal(bgCands.filter(c => c.type === 'background').length, 2);
const bgMid = bgCands.find(c => c.type === 'midpoint');
assert.ok(bgMid, 'Background slice segment should have midpoint');
assert.equal(bgMid.point.x, 0);
assert.equal(bgMid.point.y, -40);

const snapBgMid = findSmartSnap(0.8, -39.5, [], bgSegments, [], defaultSettings, 5, 5);
assert.equal(snapBgMid.type, 'midpoint');
assert.equal(snapBgMid.point.x, 0);
assert.equal(snapBgMid.point.y, -40);

// 4. Test Symmetry across Y axis (X = 0)
const existingPoint = { x: 35, y: 15 };
const symCands = getSymmetryCandidates([existingPoint], { x: -34, y: 15.5 }, defaultSettings, 5);
const symMatch = symCands.find(c => c.type === 'symmetry');
assert.ok(symMatch, 'Should generate symmetry candidate mirrored across Y axis');
assert.equal(symMatch.point.x, -35);
assert.equal(symMatch.point.y, 15);

// 5. Test Primary Axis Snap (X = 0)
const snapAxis = findSmartSnap(0.2, 55, [], [], [], defaultSettings, 5, 5);
assert.equal(snapAxis.type, 'axis');
assert.equal(snapAxis.point.x, 0);
assert.equal(snapAxis.point.y, 55);

console.log('✅ Smart OSNAP unit tests passed successfully!');

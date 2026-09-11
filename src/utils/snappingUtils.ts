import * as THREE from 'three';
import { Point2D, PlaneType, Profile } from '../types';

export type SnapType = 
  | 'vertex' 
  | 'midpoint' 
  | 'center' 
  | 'quadrant' 
  | 'symmetry' 
  | 'background' 
  | 'intersection' 
  | 'edge' 
  | 'parallel' 
  | 'perpendicular' 
  | 'tangent'
  | 'axis' 
  | 'grid' 
  | 'none';

export interface Guideline {
  type: 'axis' | 'angle' | 'symmetry';
  axis?: 'x' | 'y';
  value?: number;
  p1?: Point2D;
  p2?: Point2D;
  snapType?: 'parallel' | 'perpendicular';
}

export interface OSNAPSettings {
  grid: boolean;
  vertex: boolean;
  midpoint: boolean;
  center: boolean;
  quadrant: boolean;
  symmetry: boolean;
  background: boolean;
  guides: boolean;
  intersection?: boolean;
  nearest?: boolean;
  perpendicular?: boolean;
  parallel?: boolean;
  tangent?: boolean;
}

export const DEFAULT_OSNAP: OSNAPSettings = {
  vertex: true, midpoint: true, center: true, quadrant: true,
  background: true, guides: true, intersection: true,
  nearest: false, perpendicular: false, parallel: false, tangent: false, grid: false, symmetry: false,
};

type Segment = { p1: Point2D; p2: Point2D };

/** Join collinear tessellation fragments so their seams are not false endpoints. */
export function mergeSnapSegments(segments: Segment[]): Segment[] {
  const lines = new Map<string, { dx: number; dy: number; h: number; spans: [number, number][] }>();
  for (const { p1, p2 } of segments) {
    let dx = p2.x - p1.x, dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-7) continue;
    dx /= length; dy /= length;
    if (dx < -1e-7 || (Math.abs(dx) < 1e-7 && dy < 0)) { dx = -dx; dy = -dy; }
    const h = -dy * p1.x + dx * p1.y;
    const key = [dx, dy, h].map(n => Math.round(n * 1e6)).join(':');
    const line = lines.get(key) || { dx, dy, h, spans: [] };
    const a = dx * p1.x + dy * p1.y, b = dx * p2.x + dy * p2.y;
    line.spans.push([Math.min(a, b), Math.max(a, b)]);
    lines.set(key, line);
  }
  const result: Segment[] = [];
  for (const { dx, dy, h, spans } of lines.values()) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    for (const [a, b] of merged) result.push({ p1: { x: dx * a - dy * h, y: dy * a + dx * h }, p2: { x: dx * b - dy * h, y: dy * b + dx * h } });
  }
  return result;
}

/** Orthogonal projection of actual feature edges, never triangle diagonals. */
export function projectMeshSnapSegments(meshes: THREE.Mesh[], plane: PlaneType): Segment[] {
  const segments: Segment[] = [];
  const project = (v: THREE.Vector3): Point2D => plane === 'XY' ? { x: v.x, y: -v.z } : plane === 'XZ' ? { x: v.x, y: v.y } : { x: v.z, y: v.y };
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, true);
    let visible = true;
    mesh.traverseAncestors(parent => { if (!parent.visible) visible = false; });
    if (!visible || !mesh.visible) continue;
    const outline = mesh.children.find(c => c instanceof THREE.LineSegments) as THREE.LineSegments | undefined;
    const edges = outline?.geometry || new THREE.EdgesGeometry(mesh.geometry, 25);
    const matrix = outline?.matrixWorld || mesh.matrixWorld;
    const points = edges.getAttribute('position');
    if (points) for (let i = 0; i + 1 < points.count; i += 2) {
      segments.push({ p1: project(new THREE.Vector3().fromBufferAttribute(points, i).applyMatrix4(matrix)), p2: project(new THREE.Vector3().fromBufferAttribute(points, i + 1).applyMatrix4(matrix)) });
    }
    if (!outline) edges.dispose();
  }
  return mergeSnapSegments(segments);
}

/** Recover closed projected outlines for center/quadrant snaps, once per scene update. */
export function referenceProfilesFromSegments(segments: Segment[]): Profile[] {
  const key = (p: Point2D) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
  const adjacency = new Map<string, number[]>();
  segments.forEach((s, i) => { for (const p of [s.p1, s.p2]) { const k = key(p); adjacency.set(k, [...(adjacency.get(k) || []), i]); } });
  const visited = new Set<number>(), profiles: Profile[] = [];
  segments.forEach((segment, start) => {
    if (visited.has(start)) return;
    const points: Point2D[] = []; let index = start, point = segment.p1, closed = false;
    while (!visited.has(index)) {
      visited.add(index); points.push(point);
      const edge = segments[index];
      point = key(point) === key(edge.p1) ? edge.p2 : edge.p1;
      const next = adjacency.get(key(point)) || [];
      if (next.length !== 2) break;
      index = next.find(i => i !== index)!;
      if (index === start) { closed = true; break; }
    }
    if (!closed || points.length < 3) return;
    const profile: Profile = { id: `reference-${start}`, type: 'polygon', isClosed: true, points };
    if (points.length >= 8) {
      const a = points[0], b = points[Math.floor(points.length / 3)], c = points[Math.floor(2 * points.length / 3)];
      const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      if (Math.abs(d) > 1e-10) {
        const aa = a.x ** 2 + a.y ** 2, bb = b.x ** 2 + b.y ** 2, cc = c.x ** 2 + c.y ** 2;
        const center = { x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d, y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d };
        const radius = Math.hypot(a.x - center.x, a.y - center.y);
        if (points.every(p => Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius) < Math.max(1e-5, radius * 1e-5))) Object.assign(profile, { type: 'circle', center, radius });
      }
    }
    profiles.push(profile);
  });
  return profiles;
}

export interface SnapCandidate {
  point: Point2D;
  type: SnapType;
  label: string;
  source?: string;
  guide?: Guideline;
}

export interface SnapResult {
  point: Point2D;
  type: SnapType;
  label: string;
  guides: Guideline[];
}

/**
 * Calculates intersection line segments between 3D solid meshes and a sketch plane.
 */
export function calculateIntersectionSegments(
  meshes: THREE.Mesh[],
  planeType: PlaneType,
  offset: number,
  maxSegments = 600
): { p1: Point2D; p2: Point2D }[] {
  const segments: { p1: Point2D; p2: Point2D }[] = [];

  const intersectEdge = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    valA: number,
    valB: number,
    targetVal: number
  ): THREE.Vector3 | null => {
    if (Math.abs(valA - valB) < 1e-7) return null;
    const t = (targetVal - valA) / (valB - valA);
    if (t < 0 || t > 1) return null;
    return new THREE.Vector3().lerpVectors(a, b, t);
  };

  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    const geom = mesh.geometry;
    if (!geom) continue;

    const positionAttr = geom.getAttribute("position");
    if (!positionAttr) continue;
    mesh.updateWorldMatrix(true, false);

    if (!geom.boundingBox) geom.computeBoundingBox();
    if (geom.boundingBox) {
      const box = geom.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      if (planeType === "XY" && (box.min.y > offset || box.max.y < offset)) continue;
      if (planeType === "XZ" && (box.min.z > offset || box.max.z < offset)) continue;
      if (planeType === "YZ" && (box.min.x > offset || box.max.x < offset)) continue;
    }

    const indexAttr = geom.getIndex();
    const matrixWorld = mesh.matrixWorld;

    const getCoord = (v: THREE.Vector3): number => {
      if (planeType === "XY") return v.y;
      if (planeType === "XZ") return v.z;
      return v.x; // YZ
    };

    const projectTo2D = (v: THREE.Vector3): Point2D => {
      if (planeType === "XY") return { x: v.x, y: -v.z };
      if (planeType === "XZ") return { x: v.x, y: v.y };
      return { x: v.z, y: v.y }; // YZ
    };

    const count = indexAttr ? indexAttr.count : positionAttr.count;
    const triCount = Math.floor(count / 3);

    for (let i = 0; i < triCount; i++) {
      if (segments.length >= maxSegments) break;

      const idx0 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
      const idx1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
      const idx2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

      const v0 = new THREE.Vector3().fromBufferAttribute(positionAttr, idx0).applyMatrix4(matrixWorld);
      const v1 = new THREE.Vector3().fromBufferAttribute(positionAttr, idx1).applyMatrix4(matrixWorld);
      const v2 = new THREE.Vector3().fromBufferAttribute(positionAttr, idx2).applyMatrix4(matrixWorld);

      const val0 = getCoord(v0);
      const val1 = getCoord(v1);
      const val2 = getCoord(v2);

      const minVal = Math.min(val0, val1, val2);
      const maxVal = Math.max(val0, val1, val2);
      if (offset < minVal || offset > maxVal) continue;

      const pts: THREE.Vector3[] = [];
      const p0 = intersectEdge(v0, v1, val0, val1, offset);
      if (p0) pts.push(p0);
      const p1 = intersectEdge(v1, v2, val1, val2, offset);
      if (p1) pts.push(p1);
      const p2 = intersectEdge(v2, v0, val2, val0, offset);
      if (p2) pts.push(p2);

      const uniquePts: THREE.Vector3[] = [];
      pts.forEach(p => {
        if (!uniquePts.some(up => up.distanceTo(p) < 1e-4)) {
          uniquePts.push(p);
        }
      });

      if (uniquePts.length === 2) {
        const pt1 = projectTo2D(uniquePts[0]);
        const pt2 = projectTo2D(uniquePts[1]);
        if (Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y) > 0.05) {
          segments.push({ p1: pt1, p2: pt2 });
        }
      }
    }
  }

  return mergeSnapSegments(segments);
}

/**
 * Extracts snap candidates from a 2D sketch profile (vertices, midpoints, centers, quadrants).
 */
export function getProfileSnapCandidates(
  profile: Profile,
  settings: OSNAPSettings
): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];

  // 1. Center of circle or arc
  if (settings.center && profile.center) {
    candidates.push({
      point: profile.center,
      type: 'center',
      label: 'Center'
    });
  }

  // 2. Quadrants of circle (North, South, East, West)
  if (settings.quadrant && profile.type === 'circle' && profile.center && profile.radius) {
    const { center, radius } = profile;
    candidates.push(
      { point: { x: center.x, y: center.y + radius }, type: 'quadrant', label: 'Quadrant' },
      { point: { x: center.x, y: center.y - radius }, type: 'quadrant', label: 'Quadrant' },
      { point: { x: center.x + radius, y: center.y }, type: 'quadrant', label: 'Quadrant' },
      { point: { x: center.x - radius, y: center.y }, type: 'quadrant', label: 'Quadrant' }
    );
  }

  // 3. Vertices & Midpoints
  if (profile.points && profile.points.length > 0) {
    const pts = profile.points;

    // Bounding / geometric center for closed polygons, rectangles, triangles
    if (settings.center && profile.isClosed && pts.length >= 3 && profile.type !== 'circle') {
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      candidates.push({
        point: { x: centerX, y: centerY },
        type: 'center',
        label: profile.type === 'rectangle' ? 'Center (Rectangle)' : 'Center'
      });
    }

    if (profile.type !== 'circle') pts.forEach((pt, i) => {
      // Vertex
      if (settings.vertex) {
        candidates.push({
          point: pt,
          type: 'vertex',
          label: 'Vertex'
        });
      }

      // Midpoint
      if (settings.midpoint && (profile.isClosed || i < pts.length - 1)) {
        const nextPt = pts[(i + 1) % pts.length];
        const midPt: Point2D = {
          x: (pt.x + nextPt.x) / 2,
          y: (pt.y + nextPt.y) / 2
        };
        candidates.push({
          point: midPt,
          type: 'midpoint',
          label: 'Midpoint'
        });
      }
    });
  }

  return candidates;
}

/**
 * Extracts snap candidates from background slice segments.
 */
export function getBackgroundSnapCandidates(
  segments: { p1: Point2D; p2: Point2D }[],
  settings: OSNAPSettings
): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];
  if (!settings.background) return candidates;

  for (const seg of segments) {
    if (settings.vertex) {
      candidates.push({ point: seg.p1, type: 'background', label: '3D Background Vertex' });
      candidates.push({ point: seg.p2, type: 'background', label: '3D Background Vertex' });
    }
    if (settings.midpoint) {
      candidates.push({
        point: {
          x: (seg.p1.x + seg.p2.x) / 2,
          y: (seg.p1.y + seg.p2.y) / 2
        },
        type: 'midpoint',
        label: '3D Background Midpoint'
      });
    }
  }

  return candidates;
}

/**
 * Calculates symmetry candidates (mirror across X=0 and Y=0 axes, plus symmetry midlines).
 */
export function getSymmetryCandidates(
  existingKeyPoints: Point2D[],
  rawCadPoint: Point2D,
  settings: OSNAPSettings,
  threshold: number
): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];
  if (!settings.symmetry) return candidates;

  // 1. Snapping to Primary Axes (X = 0 and Y = 0)
  if (Math.abs(rawCadPoint.x) < threshold * 0.85) {
    candidates.push({
      point: { x: 0, y: rawCadPoint.y },
      type: 'axis',
      label: 'Center Y Axis (X = 0)',
      guide: { type: 'axis', axis: 'x', value: 0 }
    });
  }
  if (Math.abs(rawCadPoint.y) < threshold * 0.85) {
    candidates.push({
      point: { x: rawCadPoint.x, y: 0 },
      type: 'axis',
      label: 'Center X Axis (Y = 0)',
      guide: { type: 'axis', axis: 'y', value: 0 }
    });
  }

  // 2. Mirror reflection of existing key points across X=0 (mirrored X) and Y=0 (mirrored Y)
  for (const kp of existingKeyPoints) {
    // Symmetrical point across Y axis (x -> -x, y -> y)
    if (Math.abs(kp.x) > 1.0) {
      const symPointX: Point2D = { x: -kp.x, y: kp.y };
      const dist = Math.hypot(rawCadPoint.x - symPointX.x, rawCadPoint.y - symPointX.y);
      if (dist < threshold) {
        candidates.push({
          point: symPointX,
          type: 'symmetry',
          label: 'Y-Axis Symmetry',
          guide: { type: 'axis', axis: 'x', value: 0 }
        });
      }
    }

    // Symmetrical point across X axis (x -> x, y -> -y)
    if (Math.abs(kp.y) > 1.0) {
      const symPointY: Point2D = { x: kp.x, y: -kp.y };
      const dist = Math.hypot(rawCadPoint.x - symPointY.x, rawCadPoint.y - symPointY.y);
      if (dist < threshold) {
        candidates.push({
          point: symPointY,
          type: 'symmetry',
          label: 'X-Axis Symmetry',
          guide: { type: 'axis', axis: 'y', value: 0 }
        });
      }
    }
  }

  return candidates;
}

/**
 * Main Smart OSNAP Engine. Evaluates candidates and returns the best magnetic lock.
 */
export function findSmartSnap(
  rawCadX: number,
  rawCadY: number,
  profiles: Profile[],
  backgroundSegments: { p1: Point2D; p2: Point2D }[],
  drawingPoints: Point2D[],
  settings: OSNAPSettings,
  snapThreshold: number,
  gridSize = 5,
  referenceProfiles: Profile[] = []
): SnapResult {
  const rawPoint: Point2D = { x: rawCadX, y: rawCadY };

  // 1. Gather all key points from active profiles
  const candidates: SnapCandidate[] = [];
  const trackingSourcePoints: Point2D[] = [{ x: 0, y: 0 }];

  if (settings.background) profiles = [...profiles, ...referenceProfiles];

  profiles.forEach(prof => {
    const profCands = getProfileSnapCandidates(prof, settings);
    if (prof.id.startsWith('reference-')) profCands.forEach(c => { c.label += ' · projected part'; });
    candidates.push(...profCands);
    profCands.forEach(c => trackingSourcePoints.push(c.point));
  });

  // 2. Gather background slice candidates
  const referenceCircles = referenceProfiles.filter(p => p.type === 'circle' && p.center && p.radius);
  const isCircleFragment = (segment: Segment) => referenceCircles.some(c => [segment.p1, segment.p2].every(p => Math.abs(Math.hypot(p.x - c.center!.x, p.y - c.center!.y) - c.radius!) < Math.max(1e-5, c.radius! * 1e-5)));
  const linearBackground = backgroundSegments.filter(s => !isCircleFragment(s));
  const bgCands = getBackgroundSnapCandidates(linearBackground, settings);
  candidates.push(...bgCands);
  bgCands.forEach(c => trackingSourcePoints.push(c.point));

  const segments: Segment[] = settings.background ? [...linearBackground] : [];
  for (const profile of profiles) {
    if (profile.type === 'circle') continue;
    for (let i = 0; i < profile.points.length - (profile.isClosed ? 0 : 1); i++) {
      segments.push({ p1: profile.points[i], p2: profile.points[(i + 1) % profile.points.length] });
    }
  }
  const foot = (point: Point2D, seg: Segment, clamp: boolean) => {
    const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-14) return null;
    let t = ((point.x - seg.p1.x) * dx + (point.y - seg.p1.y) * dy) / l2;
    if (clamp) t = Math.max(0, Math.min(1, t));
    else if (t < 0 || t > 1) return null;
    return { x: seg.p1.x + t * dx, y: seg.p1.y + t * dy };
  };
  // Local broad phase avoids comparing all assembly edges on every pointer move.
  const nearby = segments.filter(seg => rawCadX >= Math.min(seg.p1.x, seg.p2.x) - snapThreshold && rawCadX <= Math.max(seg.p1.x, seg.p2.x) + snapThreshold && rawCadY >= Math.min(seg.p1.y, seg.p2.y) - snapThreshold && rawCadY <= Math.max(seg.p1.y, seg.p2.y) + snapThreshold);
  if (settings.intersection) for (let i = 0; i < nearby.length; i++) for (let j = i + 1; j < nearby.length; j++) {
    const a = nearby[i], b = nearby[j];
    const dx = a.p2.x - a.p1.x, dy = a.p2.y - a.p1.y;
    const ex = b.p2.x - b.p1.x, ey = b.p2.y - b.p1.y;
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-10) continue;
    const x = b.p1.x - a.p1.x, y = b.p1.y - a.p1.y;
    const t = (x * ey - y * ex) / det, u = (x * dy - y * dx) / det;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) candidates.push({ point: { x: a.p1.x + t * dx, y: a.p1.y + t * dy }, type: 'intersection', label: 'Projected Intersection' });
  }
  const anchor = drawingPoints[drawingPoints.length - 1];
  const secondary: SnapCandidate[] = [];
  for (const seg of nearby) {
    if (settings.nearest) {
      const point = foot(rawPoint, seg, true);
      if (point) secondary.push({ point, type: 'edge', label: 'Nearest · edge' });
    }
    if (settings.perpendicular && anchor) {
      const point = foot(anchor, seg, false);
      if (point) candidates.push({ point, type: 'perpendicular', label: 'Perpendicular', guide: { type: 'angle', p1: anchor, p2: point, snapType: 'perpendicular' } });
    }
  }
  if (settings.parallel && anchor) for (const seg of segments) {
    const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-14) continue;
    const t = ((rawCadX - anchor.x) * dx + (rawCadY - anchor.y) * dy) / l2;
    const point = { x: anchor.x + t * dx, y: anchor.y + t * dy };
    secondary.push({ point, type: 'parallel', label: 'Parallel', guide: { type: 'angle', p1: anchor, p2: point, snapType: 'parallel' } });
  }
  for (const profile of profiles) {
    if (profile.type !== 'circle' || !profile.center || !profile.radius) continue;
    const c = profile.center, r = profile.radius;
    const dx = rawCadX - c.x, dy = rawCadY - c.y, dist = Math.hypot(dx, dy);
    if (settings.nearest && dist > 1e-10) secondary.push({ point: { x: c.x + r * dx / dist, y: c.y + r * dy / dist }, type: 'edge', label: 'Nearest · circle' });
    if (settings.tangent && anchor) {
      const ax = anchor.x - c.x, ay = anchor.y - c.y, d2 = ax * ax + ay * ay;
      if (d2 > r * r) {
        const k = r * r / d2, h = r * Math.sqrt(d2 - r * r) / d2;
        for (const sign of [-1, 1]) candidates.push({ point: { x: c.x + k * ax - sign * h * ay, y: c.y + k * ay + sign * h * ax }, type: 'tangent', label: 'Tangent to circle' });
      }
    }
  }

  // 3. Gather symmetry candidates
  const symCands = getSymmetryCandidates(trackingSourcePoints, rawPoint, settings, snapThreshold);
  candidates.push(...symCands);

  // 4. Evaluate priority point snaps
  // Priority order: center > midpoint > quadrant > vertex > background > symmetry > axis
  const typeWeight: Record<SnapType, number> = {
    center: 1.3,
    midpoint: 1.25,
    quadrant: 1.1,
    vertex: 1.0,
    background: 0.95,
    symmetry: 0.9,
    axis: 0.85,
    intersection: 0.8,
    edge: 0.7,
    parallel: 0.7,
    perpendicular: 0.7,
    tangent: 1.1,
    grid: 0.6,
    none: 0.0
  };

  let bestCandidate: SnapCandidate | null = null;
  let bestScore = Infinity;

  for (const cand of [...candidates, ...secondary]) {
    const dist = Math.hypot(rawCadX - cand.point.x, rawCadY - cand.point.y);
    const weight = typeWeight[cand.type] || 1.0;
    const maxAllowedDist = snapThreshold * weight;

    if (dist < maxAllowedDist) {
      // Score balances distance and priority weight
      const score = dist / weight + (secondary.includes(cand) ? snapThreshold * 2 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }
  }

  if (bestCandidate) {
    const guides: Guideline[] = [];
    if (bestCandidate.guide) guides.push(bestCandidate.guide);
    return {
      point: {
        x: bestCandidate.point.x,
        y: bestCandidate.point.y
      },
      type: bestCandidate.type,
      label: bestCandidate.label,
      guides
    };
  }

  // 5. Tracking Guides (Horizontal & Vertical alignment to key points)
  let snapX = rawCadX;
  let snapY = rawCadY;
  let type: SnapType = 'none';
  let label = '';
  const guides: Guideline[] = [];

  if (settings.guides) {
    const trackingPoints: Point2D[] = [...drawingPoints, ...trackingSourcePoints];
    profiles.forEach(p => {
      if (p.center) trackingPoints.push(p.center);
      if (p.points && p.type !== 'circle') p.points.forEach(pt => trackingPoints.push(pt));
    });

    let bestGuideX: number | null = null;
    let minGuideDistX = snapThreshold * 0.7;
    let bestGuideY: number | null = null;
    let minGuideDistY = snapThreshold * 0.7;

    for (const pt of trackingPoints) {
      const dx = Math.abs(rawCadX - pt.x);
      if (dx < minGuideDistX) {
        minGuideDistX = dx;
        bestGuideX = pt.x;
      }
      const dy = Math.abs(rawCadY - pt.y);
      if (dy < minGuideDistY) {
        minGuideDistY = dy;
        bestGuideY = pt.y;
      }
    }

    if (bestGuideX !== null) {
      snapX = bestGuideX;
      guides.push({ type: 'axis', axis: 'x', value: bestGuideX });
      type = 'axis';
      label = `Alineado X (${bestGuideX.toFixed(1)} mm)`;
    }
    if (bestGuideY !== null) {
      snapY = bestGuideY;
      guides.push({ type: 'axis', axis: 'y', value: bestGuideY });
      type = 'axis';
      label = label ? `${label} + Y (${bestGuideY.toFixed(1)} mm)` : `Alineado Y (${bestGuideY.toFixed(1)} mm)`;
    }
  }

  // 6. Grid Snapping (if active and not snapped to guides)
  if (settings.grid && type === 'none') {
    const gridX = Math.round(snapX / gridSize) * gridSize;
    const gridY = Math.round(snapY / gridSize) * gridSize;
    const distGrid = Math.hypot(snapX - gridX, snapY - gridY);
    if (distGrid < snapThreshold * 0.65) {
      snapX = gridX;
      snapY = gridY;
      type = 'grid';
      label = `Rejilla (${gridSize} mm)`;
    }
  }

  return {
    point: { x: snapX, y: snapY },
    type,
    label,
    guides
  };
}

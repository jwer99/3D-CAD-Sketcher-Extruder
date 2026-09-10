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
    if (!positionAttr || positionAttr.count > 120000) continue;

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
          segments.push({
            p1: { x: parseFloat(pt1.x.toFixed(2)), y: parseFloat(pt1.y.toFixed(2)) },
            p2: { x: parseFloat(pt2.x.toFixed(2)), y: parseFloat(pt2.y.toFixed(2)) }
          });
        }
      }
    }
  }

  return segments;
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
      label: 'Centro'
    });
  }

  // 2. Quadrants of circle (North, South, East, West)
  if (settings.quadrant && profile.type === 'circle' && profile.center && profile.radius) {
    const { center, radius } = profile;
    candidates.push(
      { point: { x: center.x, y: center.y + radius }, type: 'quadrant', label: 'Cuadrante' },
      { point: { x: center.x, y: center.y - radius }, type: 'quadrant', label: 'Cuadrante' },
      { point: { x: center.x + radius, y: center.y }, type: 'quadrant', label: 'Cuadrante' },
      { point: { x: center.x - radius, y: center.y }, type: 'quadrant', label: 'Cuadrante' }
    );
  }

  // 3. Vertices & Midpoints
  if (profile.points && profile.points.length > 0) {
    const pts = profile.points;

    // Bounding / geometric center for closed polygons, rectangles, triangles
    if (settings.center && profile.isClosed && pts.length >= 3 && profile.type !== 'circle') {
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const centerX = parseFloat(((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(2));
      const centerY = parseFloat(((Math.min(...ys) + Math.max(...ys)) / 2).toFixed(2));
      candidates.push({
        point: { x: centerX, y: centerY },
        type: 'center',
        label: profile.type === 'rectangle' ? 'Centro (Rectángulo)' : 'Centro'
      });
    }

    pts.forEach((pt, i) => {
      // Vertex
      if (settings.vertex) {
        candidates.push({
          point: pt,
          type: 'vertex',
          label: 'Vértice'
        });
      }

      // Midpoint
      if (settings.midpoint && (profile.isClosed || i < pts.length - 1)) {
        const nextPt = pts[(i + 1) % pts.length];
        const midPt: Point2D = {
          x: parseFloat(((pt.x + nextPt.x) / 2).toFixed(2)),
          y: parseFloat(((pt.y + nextPt.y) / 2).toFixed(2))
        };
        candidates.push({
          point: midPt,
          type: 'midpoint',
          label: 'Punto Medio'
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
      candidates.push({ point: seg.p1, type: 'background', label: 'Vértice Fondo 3D' });
      candidates.push({ point: seg.p2, type: 'background', label: 'Vértice Fondo 3D' });
    }
    if (settings.midpoint) {
      candidates.push({
        point: {
          x: parseFloat(((seg.p1.x + seg.p2.x) / 2).toFixed(2)),
          y: parseFloat(((seg.p1.y + seg.p2.y) / 2).toFixed(2))
        },
        type: 'midpoint',
        label: 'Punto Medio (Fondo 3D)'
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
      label: 'Eje Central Y (X = 0)',
      guide: { type: 'axis', axis: 'x', value: 0 }
    });
  }
  if (Math.abs(rawCadPoint.y) < threshold * 0.85) {
    candidates.push({
      point: { x: rawCadPoint.x, y: 0 },
      type: 'axis',
      label: 'Eje Central X (Y = 0)',
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
          label: 'Simétrico Eje Y',
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
          label: 'Simétrico Eje X',
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
  gridSize = 5
): SnapResult {
  const rawPoint: Point2D = { x: rawCadX, y: rawCadY };

  // 1. Gather all key points from active profiles
  const candidates: SnapCandidate[] = [];
  const trackingSourcePoints: Point2D[] = [{ x: 0, y: 0 }];

  profiles.forEach(prof => {
    const profCands = getProfileSnapCandidates(prof, settings);
    candidates.push(...profCands);
    profCands.forEach(c => trackingSourcePoints.push(c.point));
  });

  // 2. Gather background slice candidates
  const bgCands = getBackgroundSnapCandidates(backgroundSegments, settings);
  candidates.push(...bgCands);
  bgCands.forEach(c => trackingSourcePoints.push(c.point));

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
    grid: 0.6,
    none: 0.0
  };

  let bestCandidate: SnapCandidate | null = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const dist = Math.hypot(rawCadX - cand.point.x, rawCadY - cand.point.y);
    const weight = typeWeight[cand.type] || 1.0;
    const maxAllowedDist = snapThreshold * weight;

    if (dist < maxAllowedDist) {
      // Score balances distance and priority weight
      const score = dist / weight;
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
        x: parseFloat(bestCandidate.point.x.toFixed(2)),
        y: parseFloat(bestCandidate.point.y.toFixed(2))
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
    const trackingPoints: Point2D[] = [...drawingPoints, { x: 0, y: 0 }];
    profiles.forEach(p => {
      if (p.center) trackingPoints.push(p.center);
      if (p.points) p.points.forEach(pt => trackingPoints.push(pt));
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
    point: { x: parseFloat(snapX.toFixed(2)), y: parseFloat(snapY.toFixed(2)) },
    type,
    label,
    guides
  };
}

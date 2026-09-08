import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import dotenv from "dotenv";
import { Jimp } from "jimp";

dotenv.config();

interface SketchProfile {
  type: "rectangle" | "circle" | "polygon" | "hexagon";
  points: { x: number; y: number }[];
  isClosed: boolean;
  center?: { x: number; y: number };
  radius?: number;
  cornerStyles?: Record<number, { type: "none" | "fillet" | "chamfer"; size: number }>;
}

interface CADSketch {
  name: string;
  plane: "XY" | "XZ" | "YZ";
  offset: number;
  profiles: SketchProfile[];
  operation: {
    type: "extrude" | "revolve";
    height?: number;
    angle?: number;
    taperScale?: number;
    booleanOp?: "new-body" | "join" | "cut";
    axis?: "X" | "Y";
  };
}

interface Point {
  x: number;
  y: number;
}

interface ContourAnalysis {
  centerX: number;
  centerY: number;
  scale: number;
  maxDim: number;
  outerLoop: Point[];
  simplifiedOuter: Point[];
  outerGrid: Uint8Array;
  nonBgComps: any[];
  labels: Int32Array;
  width: number;
  height: number;
  objectBodyLabel: number;
}

// Distance from point to line segment
function getSqSegDist(p: Point, p1: Point, p2: Point): number {
  let x = p1.x, y = p1.y,
      dx = p2.x - x, dy = p2.y - y;
  if (dx !== 0 || dy !== 0) {
    let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points: Point[], first: number, last: number, sqTolerance: number, simplified: Point[]) {
  let maxSqDist = sqTolerance,
      index = -1;
  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (index !== -1) {
    simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function simplifyDouglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}

// Marching Squares implementation
function marchingSquares(binaryGrid: Uint8Array, width: number, height: number) {
  const segments: { a: Point; b: Point }[] = [];
  
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v00 = binaryGrid[y * width + x] === 255;
      const v10 = binaryGrid[y * width + (x + 1)] === 255;
      const v11 = binaryGrid[(y + 1) * width + (x + 1)] === 255;
      const v01 = binaryGrid[(y + 1) * width + x] === 255;
      
      const idx = (v00 ? 8 : 0) | (v10 ? 4 : 0) | (v11 ? 2 : 0) | (v01 ? 1 : 0);
      
      const pT = { x: x + 0.5, y: y };
      const pR = { x: x + 1, y: y + 0.5 };
      const pB = { x: x + 0.5, y: y + 1 };
      const pL = { x: x, y: y + 0.5 };
      
      switch (idx) {
        case 1:  segments.push({ a: pL, b: pB }); break;
        case 2:  segments.push({ a: pB, b: pR }); break;
        case 3:  segments.push({ a: pL, b: pR }); break;
        case 4:  segments.push({ a: pT, b: pR }); break;
        case 5:  segments.push({ a: pL, b: pT }); segments.push({ a: pB, b: pR }); break;
        case 6:  segments.push({ a: pT, b: pB }); break;
        case 7:  segments.push({ a: pL, b: pT }); break;
        case 8:  segments.push({ a: pL, b: pT }); break;
        case 9:  segments.push({ a: pT, b: pB }); break;
        case 10: segments.push({ a: pL, b: pB }); segments.push({ a: pT, b: pR }); break;
        case 11: segments.push({ a: pT, b: pR }); break;
        case 12: segments.push({ a: pL, b: pR }); break;
        case 13: segments.push({ a: pB, b: pR }); break;
        case 14: segments.push({ a: pL, b: pB }); break;
        default: break;
      }
    }
  }
  return segments;
}

// Assemble segments into closed loops
function assembleLoops(segments: { a: Point; b: Point }[]) {
  const loops: Point[][] = [];
  const used = new Uint8Array(segments.length);
  
  const ptMap = new Map<string, { idx: number; isStart: boolean }[]>();
  segments.forEach((seg, idx) => {
    const keyA = `${seg.a.x.toFixed(1)},${seg.a.y.toFixed(1)}`;
    if (!ptMap.has(keyA)) ptMap.set(keyA, []);
    ptMap.get(keyA)!.push({ idx, isStart: true });
    
    const keyB = `${seg.b.x.toFixed(1)},${seg.b.y.toFixed(1)}`;
    if (!ptMap.has(keyB)) ptMap.set(keyB, []);
    ptMap.get(keyB)!.push({ idx, isStart: false });
  });

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    
    const currentLoop = [segments[i].a, segments[i].b];
    used[i] = 1;
    let currentPt = segments[i].b;
    let done = false;
    
    while (!done) {
      const key = `${currentPt.x.toFixed(1)},${currentPt.y.toFixed(1)}`;
      const candidates = ptMap.get(key) || [];
      let foundNext = false;
      
      for (const cand of candidates) {
        if (!used[cand.idx]) {
          used[cand.idx] = 1;
          const nextSeg = segments[cand.idx];
          currentPt = cand.isStart ? nextSeg.b : nextSeg.a;
          currentLoop.push(currentPt);
          foundNext = true;
          break;
        }
      }
      
      if (!foundNext) {
        done = true;
      } else {
        const dx = currentPt.x - currentLoop[0].x;
        const dy = currentPt.y - currentLoop[0].y;
        if (dx * dx + dy * dy < 0.1) {
          done = true;
        }
      }
    }
    
    // Ignore small loops
    if (currentLoop.length > 25) {
      loops.push(currentLoop);
    }
  }
  return loops;
}

function getPolygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
}

function getPolygonPerimeter(points: Point[]): number {
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    perimeter += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }
  return perimeter;
}

// Dilate / Erode helpers for morphological closing
function dilate(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dst = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (src[y * width + x] === 1) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              dst[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }
  return dst;
}

function erode(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dst = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allOn = true;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (src[ny * width + nx] !== 1) {
              allOn = false;
              break;
            }
          } else {
            allOn = false;
            break;
          }
        }
        if (!allOn) break;
      }
      dst[y * width + x] = allOn ? 1 : 0;
    }
  }
  return dst;
}

// Convex hull & corners helpers
function crossProduct(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  if (pts.length <= 1) return pts;
  
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    if (this.parent[i] === i) return i;
    this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }
  union(i: number, j: number): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent[rootI] = rootJ;
    }
  }
}

function getPrincipalAngle(points: Point[]): number {
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;

  let covXX = 0, covYY = 0, covXY = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }
  
  return 0.5 * Math.atan2(2 * covXY, covXX - covYY);
}

function rotatePoints(pts: Point[], angle: number, cx: number, cy: number): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pts.map(p => ({
    x: (p.x - cx) * cos - (p.y - cy) * sin + cx,
    y: (p.x - cx) * sin + (p.y - cy) * cos + cy
  }));
}

function orthogonalizePolygon(pts: Point[]): Point[] {
  const n = pts.length;
  if (n < 3) return pts;
  
  let sumX = 0, sumY = 0;
  for (const p of pts) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / n;
  const cy = sumY / n;
  
  const theta = getPrincipalAngle(pts);
  
  const angleDeg = (theta * 180) / Math.PI;
  const normAngle = ((angleDeg % 90) + 90) % 90;
  let snapToAxis = false;
  let snapAngle = theta;
  if (normAngle < 15) {
    snapToAxis = true;
    snapAngle = ((angleDeg - normAngle) * Math.PI) / 180;
  } else if (normAngle > 75) {
    snapToAxis = true;
    snapAngle = ((angleDeg + (90 - normAngle)) * Math.PI) / 180;
  }
  
  const alignedPts = rotatePoints(pts, -theta, cx, cy);
  
  const ufX = new UnionFind(n);
  const ufY = new UnionFind(n);
  
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const p1 = alignedPts[i];
    const p2 = alignedPts[next];
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    
    let angle = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
    if (angle > 90) angle = 180 - angle;
    
    if (angle < 22.5) {
      ufY.union(i, next);
    } else if (angle > 67.5) {
      ufX.union(i, next);
    }
  }
  
  const xGroups = new Map<number, number[]>();
  const yGroups = new Map<number, number[]>();
  
  for (let i = 0; i < n; i++) {
    const rootX = ufX.find(i);
    if (!xGroups.has(rootX)) xGroups.set(rootX, []);
    xGroups.get(rootX)!.push(alignedPts[i].x);
    
    const rootY = ufY.find(i);
    if (!yGroups.has(rootY)) yGroups.set(rootY, []);
    yGroups.get(rootY)!.push(alignedPts[i].y);
  }
  
  const xAverages = new Map<number, number>();
  const yAverages = new Map<number, number>();
  
  xGroups.forEach((val, key) => {
    const avg = val.reduce((a, b) => a + b, 0) / val.length;
    xAverages.set(key, avg);
  });
  
  yGroups.forEach((val, key) => {
    const avg = val.reduce((a, b) => a + b, 0) / val.length;
    yAverages.set(key, avg);
  });
  
  const orthoPts = alignedPts.map((p, i) => ({
    x: xAverages.get(ufX.find(i))!,
    y: yAverages.get(ufY.find(i))!
  }));
  
  const angleToRotateBack = snapToAxis ? snapAngle : theta;
  return rotatePoints(orthoPts, angleToRotateBack, cx, cy);
}

function detectLocalCornerStyles(
  denseLoop: Point[],
  orthoPoints: Point[],
  scale: number
): Record<number, { type: "none" | "fillet" | "chamfer"; size: number }> {
  const cornerStyles: Record<number, { type: "none" | "fillet" | "chamfer"; size: number }> = {};
  const n = orthoPoints.length;
  if (n < 3) return cornerStyles;

  for (let i = 0; i < n; i++) {
    const prevPt = orthoPoints[(i - 1 + n) % n];
    const currPt = orthoPoints[i];
    const nextPt = orthoPoints[(i + 1) % n];

    // Normalized vectors along the edges
    const v1 = { x: prevPt.x - currPt.x, y: prevPt.y - currPt.y };
    const v2 = { x: nextPt.x - currPt.x, y: nextPt.y - currPt.y };
    const L1 = Math.hypot(v1.x, v1.y);
    const L2 = Math.hypot(v2.x, v2.y);
    if (L1 < 1e-4 || L2 < 1e-4) continue;

    const u1 = { x: v1.x / L1, y: v1.y / L1 };
    const u2 = { x: v2.x / L2, y: v2.y / L2 };

    const dot = u1.x * u2.x + u1.y * u2.y;
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const theta = Math.acos(clampedDot);

    if (theta < 1e-2 || theta > Math.PI - 1e-2) continue;

    const halfTheta = theta / 2;

    // Find closest point in denseLoop to currPt
    let dMin = Infinity;
    let closestIdx = -1;
    for (let j = 0; j < denseLoop.length; j++) {
      const p = denseLoop[j];
      const d = Math.hypot(p.x - currPt.x, p.y - currPt.y);
      if (d < dMin) {
        dMin = d;
        closestIdx = j;
      }
    }

    if (closestIdx === -1) continue;

    // If dMin is very small, it's a sharp corner
    if (dMin < 2.0) continue;

    // Let's gather the neighborhood transition points
    const midPrev = { x: (prevPt.x + currPt.x) / 2, y: (prevPt.y + currPt.y) / 2 };
    const midNext = { x: (nextPt.x + currPt.x) / 2, y: (nextPt.y + currPt.y) / 2 };

    let idxPrev = -1;
    let idxNext = -1;
    let minDPrev = Infinity;
    let minDNext = Infinity;

    for (let j = 0; j < denseLoop.length; j++) {
      const p = denseLoop[j];
      const distPrev = Math.hypot(p.x - midPrev.x, p.y - midPrev.y);
      const distNext = Math.hypot(p.x - midNext.x, p.y - midNext.y);
      if (distPrev < minDPrev) {
        minDPrev = distPrev;
        idxPrev = j;
      }
      if (distNext < minDNext) {
        minDNext = distNext;
        idxNext = j;
      }
    }

    if (idxPrev === -1 || idxNext === -1) continue;

    const transitionPoints: Point[] = [];
    let idx = idxPrev;
    const maxIterations = denseLoop.length;
    let count = 0;
    while (idx !== idxNext && count < maxIterations) {
      transitionPoints.push(denseLoop[idx]);
      idx = (idx + 1) % denseLoop.length;
      count++;
    }
    transitionPoints.push(denseLoop[idxNext]);

    // Compute expected sizes
    const T_chamfer = dMin / Math.cos(halfTheta);
    const R_fillet = dMin / (1 / Math.sin(halfTheta) - 1);
    const T_fillet = R_fillet / Math.tan(halfTheta);

    const getDistToSegment = (pt: Point, p1: Point, p2: Point) => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(pt.x - p1.x, pt.y - p1.y);
      let t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(pt.x - (p1.x + t * dx), pt.y - (p1.y + t * dy));
    };

    // 1. Chamfer Hypothesis Path
    const C1 = { x: currPt.x + T_chamfer * u1.x, y: currPt.y + T_chamfer * u1.y };
    const C2 = { x: currPt.x + T_chamfer * u2.x, y: currPt.y + T_chamfer * u2.y };

    const getDistToChamferPath = (pt: Point) => {
      const d1 = getDistToSegment(pt, prevPt, C1);
      const d2 = getDistToSegment(pt, C1, C2);
      const d3 = getDistToSegment(pt, C2, nextPt);
      return Math.min(d1, d2, d3);
    };

    let errChamferSum = 0;
    for (const p of transitionPoints) {
      errChamferSum += getDistToChamferPath(p);
    }
    const maeChamfer = errChamferSum / transitionPoints.length;

    // 2. Fillet Hypothesis Path
    const F1 = { x: currPt.x + T_fillet * u1.x, y: currPt.y + T_fillet * u1.y };
    const F2 = { x: currPt.x + T_fillet * u2.x, y: currPt.y + T_fillet * u2.y };

    const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bisectorLen = Math.hypot(bisector.x, bisector.y);
    const uB = bisectorLen > 1e-4 ? { x: bisector.x / bisectorLen, y: bisector.y / bisectorLen } : { x: 0, y: 0 };
    const D = R_fillet / Math.sin(halfTheta);
    const center = { x: currPt.x + D * uB.x, y: currPt.y + D * uB.y };

    const uArcBisector = { x: -uB.x, y: -uB.y };
    const sectorHalfAngle = (Math.PI - theta) / 2;
    const cosSectorLimit = Math.cos(sectorHalfAngle);

    const getDistToFilletPath = (pt: Point) => {
      const d1 = getDistToSegment(pt, prevPt, F1);
      const d2 = getDistToSegment(pt, F2, nextPt);

      const dx = pt.x - center.x;
      const dy = pt.y - center.y;
      const distToCenter = Math.hypot(dx, dy);

      let dArc = Infinity;
      if (distToCenter > 1e-4) {
        const w = { x: dx / distToCenter, y: dy / distToCenter };
        const cosAlpha = w.x * uArcBisector.x + w.y * uArcBisector.y;
        if (cosAlpha >= cosSectorLimit) {
          dArc = Math.abs(distToCenter - R_fillet);
        } else {
          dArc = Math.min(Math.hypot(pt.x - F1.x, pt.y - F1.y), Math.hypot(pt.x - F2.x, pt.y - F2.y));
        }
      } else {
        dArc = R_fillet;
      }

      return Math.min(d1, d2, dArc);
    };

    let errFilletSum = 0;
    for (const p of transitionPoints) {
      errFilletSum += getDistToFilletPath(p);
    }
    const maeFillet = errFilletSum / transitionPoints.length;

    if (maeFillet < maeChamfer) {
      cornerStyles[i] = { type: "fillet", size: parseFloat((R_fillet * scale).toFixed(1)) };
    } else {
      cornerStyles[i] = { type: "chamfer", size: parseFloat((T_chamfer * scale).toFixed(1)) };
    }
  }

  return cornerStyles;
}

function regularizeSketchLoop(
  loop: Point[],
  scale: number,
  centerX: number,
  centerY: number,
  isOuter: boolean = false
): { type: "circle" | "polygon"; points: Point[]; center?: Point; radius?: number; cornerStyles?: Record<number, { type: "none" | "fillet" | "chamfer"; size: number }> } {
  if (loop.length < 3) return { type: "polygon", points: [] };
  
  let sumX = 0, sumY = 0;
  for (const p of loop) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / loop.length;
  const cy = sumY / loop.length;
  
  const dists = loop.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
  const R = dists.reduce((a, b) => a + b, 0) / loop.length;
  const variance = dists.reduce((sum, d) => sum + (d - R) ** 2, 0) / loop.length;
  const stdDev = Math.sqrt(variance);
  const relStdDev = stdDev / R;
  
  const area = getPolygonArea(loop);
  const perimeter = getPolygonPerimeter(loop);
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  
  console.log(`-- Loop Analysis (isOuter=${isOuter}): size/ptsCount=${loop.length}, area=${area.toFixed(1)}, peri=${perimeter.toFixed(1)}, circ=${circularity.toFixed(3)}, relStdDev=${relStdDev.toFixed(4)}`);

  const circleCircularityThresh = isOuter ? 0.60 : 0.45;
  const circleStdDevThresh = isOuter ? 0.28 : 0.38;

  if (circularity > circleCircularityThresh && relStdDev < circleStdDevThresh) {
    const points: Point[] = [];
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      const px = cx + R * Math.cos(theta);
      const py = cy + R * Math.sin(theta);
      points.push({
        x: parseFloat(((px - centerX) * scale).toFixed(2)),
        y: parseFloat((-(py - centerY) * scale).toFixed(2))
      });
    }
    const scaledCenterX = parseFloat(((cx - centerX) * scale).toFixed(2));
    const scaledCenterY = parseFloat((-(cy - centerY) * scale).toFixed(2));
    const scaledRadius = parseFloat((R * scale).toFixed(2));
    return {
      type: "circle",
      points,
      center: { x: scaledCenterX, y: scaledCenterY },
      radius: scaledRadius
    };
  }
  
  const dpTolerance = isOuter && loop.length > 1000 ? 4.5 : 2.5;
  let simplified = simplifyDouglasPeucker(loop, dpTolerance);
  if (simplified.length > 2) {
    const pFirst = simplified[0];
    const pLast = simplified[simplified.length - 1];
    const distSq = (pFirst.x - pLast.x) ** 2 + (pFirst.y - pLast.y) ** 2;
    if (distSq < 0.1) {
      simplified = simplified.slice(0, -1);
    }
  }
  
  console.log(`-- DP Simplification: simplifiedPtsCount=${simplified.length}`);

  // STRICT PRIMITIVE ENFORCEMENT:
  // If the polygon has a complex number of points, we force it to an axis-aligned bounding rectangle.
  // This guarantees we ONLY ever output simple primitive shapes (3=triangle, 4=rectangle, 6=hexagon).
  if (simplified.length > 6 || (simplified.length !== 3 && simplified.length !== 4 && simplified.length !== 6)) {
     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
     for (const p of loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
     }
     simplified = [
       { x: minX, y: minY },
       { x: maxX, y: minY },
       { x: maxX, y: maxY },
       { x: minX, y: maxY }
     ];
     console.log(`-- Forced to Bounding Rectangle (4 pts)`);
  }

  if (simplified.length < 3) {
    const points = loop.map(p => ({
      x: parseFloat(((p.x - centerX) * scale).toFixed(2)),
      y: parseFloat((-(p.y - centerY) * scale).toFixed(2))
    }));
    return { type: "polygon", points };
  }
  
  const orthoPts = orthogonalizePolygon(simplified);
  const cornerStyles = detectLocalCornerStyles(loop, orthoPts, scale);
  
  const points = orthoPts.map(p => ({
    x: parseFloat(((p.x - centerX) * scale).toFixed(2)),
    y: parseFloat((-(p.y - centerY) * scale).toFixed(2))
  }));
  
  return {
    type: "polygon",
    points,
    cornerStyles
  };
}

function findMaxAreaTriangle(points: Point[]): { maxArea: number; bestPoints: Point[] } {
  let maxArea = 0;
  let bestPoints: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = points[i];
        const b = points[j];
        const c = points[k];
        const area = getPolygonArea([a, b, c]);
        if (area > maxArea) {
          maxArea = area;
          bestPoints = [a, b, c];
        }
      }
    }
  }
  return { maxArea, bestPoints };
}

function findMaxAreaQuad(points: Point[]): { maxArea: number; bestPoints: Point[] } {
  let maxArea = 0;
  let bestPoints: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          const a = points[i];
          const b = points[j];
          const c = points[k];
          const d = points[l];
          const area = getPolygonArea([a, b, c, d]);
          if (area > maxArea) {
            maxArea = area;
            bestPoints = [a, b, c, d];
          }
        }
      }
    }
  }
  return { maxArea, bestPoints };
}

function createPrimitiveSketch(
  shape: "cube" | "sphere" | "cylinder" | "cone" | "tetrahedron",
  centerX: number,
  centerY: number,
  scale: number,
  maxDim: number
): CADSketch {
  const physicalDim = maxDim * scale;
  const radius = parseFloat((physicalDim / 2).toFixed(2));
  
  if (shape === "sphere") {
    const points: Point[] = [];
    points.push({ x: 0, y: -radius });
    for (let i = 0; i <= 16; i++) {
      const theta = -Math.PI / 2 + (i / 16) * Math.PI;
      points.push({
        x: parseFloat((radius * Math.cos(theta)).toFixed(2)),
        y: parseFloat((radius * Math.sin(theta)).toFixed(2))
      });
    }
    points.push({ x: 0, y: radius });
    points.push({ x: 0, y: -radius });
    
    return {
      name: "Esfera Reconstruida",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points,
        isClosed: true
      }],
      operation: {
        type: "revolve",
        angle: 360,
        taperScale: 0.0
      }
    };
  }
  
  if (shape === "cylinder") {
    const points: Point[] = [];
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      points.push({
        x: parseFloat((radius * Math.cos(theta)).toFixed(2)),
        y: parseFloat((radius * Math.sin(theta)).toFixed(2))
      });
    }
    return {
      name: "Cilindro Reconstruido",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points,
        isClosed: true
      }],
      operation: {
        type: "extrude",
        height: parseFloat(physicalDim.toFixed(2)),
        taperScale: 1.0
      }
    };
  }
  
  if (shape === "cone") {
    const points: Point[] = [];
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      points.push({
        x: parseFloat((radius * Math.cos(theta)).toFixed(2)),
        y: parseFloat((radius * Math.sin(theta)).toFixed(2))
      });
    }
    return {
      name: "Cono Reconstruido",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points,
        isClosed: true
      }],
      operation: {
        type: "extrude",
        height: parseFloat(physicalDim.toFixed(2)),
        taperScale: 0.0
      }
    };
  }
  
  if (shape === "tetrahedron") {
    const size = physicalDim;
    const h = size * Math.sqrt(3) / 2;
    const points: Point[] = [
      { x: 0, y: parseFloat((2 * h / 3).toFixed(2)) },
      { x: parseFloat((size / 2).toFixed(2)), y: parseFloat((-h / 3).toFixed(2)) },
      { x: parseFloat((-size / 2).toFixed(2)), y: parseFloat((-h / 3).toFixed(2)) }
    ];
    return {
      name: "Tetraedro Reconstruido",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points: points,
        isClosed: true
      }],
      operation: {
        type: "extrude",
        height: parseFloat(physicalDim.toFixed(2)),
        taperScale: 0.0
      }
    };
  }
  
  // Default: Cube
  const size = radius;
  const points: Point[] = [
    { x: -size, y: -size },
    { x: size, y: -size },
    { x: size, y: size },
    { x: -size, y: size }
  ];
  return {
    name: "Cubo Reconstruido",
    plane: "XY",
    offset: 0,
    profiles: [{
      type: "polygon",
      points,
      isClosed: true
    }],
    operation: {
      type: "extrude",
      height: parseFloat(physicalDim.toFixed(2)),
      taperScale: 1.0
    }
  };
}

function regularizeSketch(sketch: any): CADSketch {
  if (!sketch || !sketch.profiles) return sketch;

  const regularizedProfiles = sketch.profiles.map((prof: any) => {
    if (prof.type === "circle" && prof.center && prof.radius !== undefined) {
      const pts: Point[] = [];
      const cx = prof.center.x;
      const cy = prof.center.y;
      const r = prof.radius;
      for (let i = 0; i < 32; i++) {
        const theta = (i / 32) * Math.PI * 2;
        pts.push({
          x: parseFloat((cx + r * Math.cos(theta)).toFixed(2)),
          y: parseFloat((cy + r * Math.sin(theta)).toFixed(2))
        });
      }
      return {
        type: "circle" as const,
        points: pts,
        center: prof.center,
        radius: r,
        isClosed: true
      };
    }

    if ((prof.type === "polygon" || prof.type === "rectangle" || prof.type === "triangle" || prof.type === "hexagon") && prof.points && prof.points.length >= 3) {
      let pts = prof.points;
      
      // FORCE COMPLEX POLYGONS INTO BOUNDING RECTANGLES (To enforce "only basic shapes" rule)
      if (prof.type === "polygon" && pts.length !== 3 && pts.length !== 4 && pts.length !== 6) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        pts = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ];
        prof.type = "rectangle";
      }

      // Sólo ortogonalizar rectángulos o polígonos que parezcan rectangulares
      if (prof.type === "rectangle" || (prof.type === "polygon" && pts.length === 4)) {
        let orthoPts = orthogonalizePolygon(pts);
        pts = orthoPts.map(p => ({
          x: parseFloat(p.x.toFixed(2)),
          y: parseFloat(p.y.toFixed(2))
        }));
      } else {
        pts = pts.map((p: any) => ({
          x: parseFloat(p.x.toFixed(2)),
          y: parseFloat(p.y.toFixed(2))
        }));
      }

      // Convertir "polygon" a su primitiva correspondiente si la IA falló en usar el string correcto
      let finalType = prof.type;
      if (finalType === "polygon") {
        if (pts.length === 3) finalType = "triangle";
        else if (pts.length === 4) finalType = "rectangle";
        else if (pts.length === 6) finalType = "hexagon";
      }

      return {
        type: finalType as any,
        points: pts,
        isClosed: prof.isClosed !== undefined ? prof.isClosed : true,
        cornerStyles: prof.cornerStyles || {}
      };
    }

    return prof;
  });

  return {
    name: sketch.name || "Boceto Reconstruido",
    plane: sketch.plane || "XY",
    offset: sketch.offset !== undefined ? sketch.offset : 0,
    profiles: regularizedProfiles,
    operation: {
      type: sketch.operation?.type || "extrude",
      height: sketch.operation?.height !== undefined ? sketch.operation.height : 20,
      taperScale: sketch.operation?.taperScale !== undefined ? sketch.operation.taperScale : 1.0,
      booleanOp: sketch.operation?.booleanOp || "new-body",
      axis: sketch.operation?.axis || "Y"
    }
  };
}


async function analyzeImageContours(base64Data: string): Promise<ContourAnalysis> {
  const buffer = Buffer.from(base64Data, "base64");
  const image = await Jimp.read(buffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  
  // 1. Grayscale
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      gray[y * width + x] = 0.299 * image.bitmap.data[idx] + 0.587 * image.bitmap.data[idx+1] + 0.114 * image.bitmap.data[idx+2];
    }
  }
  
  // 2. Sobel Edge Detection
  const magnitude = new Float32Array(width * height);
  let maxMag = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const val = (dx: number, dy: number) => gray[(y + dy) * width + (x + dx)];
      const gx = -1 * val(-1,-1) + 1 * val(1,-1) - 2 * val(-1,0) + 2 * val(1,0) - 1 * val(-1,1) + 1 * val(1,1);
      const gy = -1 * val(-1,-1) - 2 * val(0,-1) - 1 * val(1,-1) + 1 * val(-1,1) + 2 * val(0,1) + 1 * val(1,1);
      const mag = Math.sqrt(gx*gx + gy*gy);
      magnitude[y * width + x] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }
  
  // 3. Threshold and morphological closing
  const edgeThreshold = 30;
  const closingRadius = 3;
  const edgeMap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const norm = maxMag > 0 ? (magnitude[i] / maxMag) * 255 : 0;
    edgeMap[i] = norm > edgeThreshold ? 1 : 0;
  }
  const closed = erode(dilate(edgeMap, width, height, closingRadius), width, height, closingRadius);
  
  // 4. BFS Connected Components labeling
  const labels = new Int32Array(width * height).fill(-1);
  let currentLabel = 0;
  interface ComponentInfo {
    label: number;
    size: number;
    touchesBorder: boolean;
  }
  const componentStats: ComponentInfo[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (closed[idx] === 1 || labels[idx] !== -1) continue;
      
      const q = [idx];
      labels[idx] = currentLabel;
      let size = 0;
      let touchesBorder = false;
      let head = 0;
      
      while (head < q.length) {
        const curr = q[head++];
        size++;
        const cx = curr % width;
        const cy = Math.floor(curr / width);
        
        if (cx <= closingRadius + 1 || cx >= width - 1 - closingRadius - 1 || 
            cy <= closingRadius + 1 || cy >= height - 1 - closingRadius - 1) {
          touchesBorder = true;
        }
        
        const neighbors = [
          { nx: cx + 1, ny: cy }, { nx: cx - 1, ny: cy }, { nx: cx, ny: cy + 1 }, { nx: cx, ny: cy - 1 }
        ];
        for (const n of neighbors) {
          if (n.nx >= 0 && n.nx < width && n.ny >= 0 && n.ny < height) {
            const nidx = n.ny * width + n.nx;
            if (closed[nidx] === 0 && labels[nidx] === -1) {
              labels[nidx] = currentLabel;
              q.push(nidx);
            }
          }
        }
      }
      componentStats.push({ label: currentLabel, size, touchesBorder });
      currentLabel++;
    }
  }
  
  // 5. Classify background vs foreground components
  const backgroundLabels = new Set<number>(
    componentStats.filter(c => c.touchesBorder).map(c => c.label)
  );
  
  const nonBgComps = componentStats.filter(c => !backgroundLabels.has(c.label));
  if (nonBgComps.length === 0) {
    throw new Error("No se pudo distinguir la pieza del fondo. Verifique la iluminación y el fondo de la imagen.");
  }
  
  nonBgComps.sort((a, b) => b.size - a.size);
  const objectBodyLabel = nonBgComps[0].label;
  
  // 6. Extract Outer loop
  const outerGrid = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    outerGrid[i] = (!backgroundLabels.has(labels[i])) ? 255 : 0;
  }
  
  const outerSegments = marchingSquares(outerGrid, width, height);
  const outerLoops = assembleLoops(outerSegments);
  
  if (outerLoops.length === 0) {
    throw new Error("No se pudo encontrar el contorno exterior de la pieza.");
  }
  
  outerLoops.sort((a, b) => b.length - a.length);
  const outerLoop = outerLoops[0];
  const simplifiedOuter = simplifyDouglasPeucker(outerLoop, 2.5);
  
  // Determine center and scale from outer loop
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of simplifiedOuter) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY);
  
  const targetSize = 80;
  const scale = targetSize / maxDim;
  
  return {
    centerX,
    centerY,
    scale,
    maxDim,
    outerLoop,
    simplifiedOuter,
    outerGrid,
    nonBgComps,
    labels,
    width,
    height,
    objectBodyLabel
  };
}

interface MaximalRect {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

function findMaximalRectangle(grid: Uint8Array, width: number, height: number): MaximalRect | null {
  const heights = new Int32Array(width).fill(0);
  let maxArea = 0;
  let bestRect: MaximalRect | null = null;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r * width + c] !== 0) {
        heights[c]++;
      } else {
        heights[c] = 0;
      }
    }

    const stack: number[] = [];
    for (let c = 0; c <= width; c++) {
      const h = c === width ? 0 : heights[c];
      while (stack.length > 0 && h < heights[stack[stack.length - 1]]) {
        const heightIdx = stack.pop()!;
        const currHeight = heights[heightIdx];
        const widthStart = stack.length === 0 ? -1 : stack[stack.length - 1];
        const currWidth = c - widthStart - 1;
        const area = currHeight * currWidth;
        
        if (area > maxArea) {
          maxArea = area;
          bestRect = {
            x: widthStart + 1,
            y: r - currHeight + 1,
            w: currWidth,
            h: currHeight,
            area: area
          };
        }
      }
      stack.push(c);
    }
  }

  return bestRect;
}

function extractMathematicalContoursFromAnalysis(analysis: ContourAnalysis): CADSketch[] {
  const {
    centerX,
    centerY,
    scale,
    maxDim,
    outerLoop,
    simplifiedOuter,
    outerGrid,
    nonBgComps,
    labels,
    width,
    height,
    objectBodyLabel
  } = analysis;
  
  // Local mathematical primitive classifier
  const area = getPolygonArea(outerLoop);
  const perimeter = getPolygonPerimeter(outerLoop);
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  
  const hull = convexHull(outerLoop);
  const hullArea = getPolygonArea(hull);
  const solidity = hullArea > 0 ? area / hullArea : 0;
  
  // If highly convex, attempt primitive classification
  if (solidity > 0.95) {
    if (circularity > 0.82) {
      if (circularity > 0.88) {
        return [createPrimitiveSketch("sphere", centerX, centerY, scale, maxDim)];
      } else {
        return [createPrimitiveSketch("cylinder", centerX, centerY, scale, maxDim)];
      }
    } else {
      const simplified8 = simplifyDouglasPeucker(outerLoop, 8.0).slice(0, -1);
      
      const triResult = findMaxAreaTriangle(simplified8);
      const triRatio = triResult.maxArea / area;
      
      if (triRatio > 0.90) {
        return [createPrimitiveSketch("tetrahedron", centerX, centerY, scale, maxDim)];
      } else {
        const quadResult = findMaxAreaQuad(simplified8);
        const quadRatio = quadResult.maxArea / area;
        
        if (quadRatio > 0.72 && circularity > 0.65) {
          return [createPrimitiveSketch("cube", centerX, centerY, scale, maxDim)];
        }
      }
    }
  }
  
  // Advanced Fallback: DP Maximal Rectangle Decomposition
  const sketches: CADSketch[] = [];
  
  const grid = new Uint8Array(outerGrid.length);
  grid.set(outerGrid);

  let initialArea = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0) initialArea++;
  }

  let remainingArea = initialArea;
  const areaThreshold = initialArea * 0.03; // Stop when < 3%
  let isFirst = true;

  while (remainingArea > areaThreshold) {
    const maxRect = findMaximalRectangle(grid, width, height);
    if (!maxRect || maxRect.area < areaThreshold) break;

    const cxRect = maxRect.x + maxRect.w / 2;
    const cyRect = maxRect.y + maxRect.h / 2;
    
    const scaledCx = parseFloat(((cxRect - centerX) * scale).toFixed(2));
    const scaledCy = parseFloat((-(cyRect - centerY) * scale).toFixed(2));
    const scaledW = parseFloat((maxRect.w * scale).toFixed(2));
    const scaledH = parseFloat((maxRect.h * scale).toFixed(2));

    const w2 = scaledW / 2;
    const h2 = scaledH / 2;

    const profile: SketchProfile = {
      type: "rectangle",
      points: [
        { x: parseFloat((scaledCx - w2).toFixed(2)), y: parseFloat((scaledCy - h2).toFixed(2)) },
        { x: parseFloat((scaledCx + w2).toFixed(2)), y: parseFloat((scaledCy - h2).toFixed(2)) },
        { x: parseFloat((scaledCx + w2).toFixed(2)), y: parseFloat((scaledCy + h2).toFixed(2)) },
        { x: parseFloat((scaledCx - w2).toFixed(2)), y: parseFloat((scaledCy + h2).toFixed(2)) }
      ],
      isClosed: true,
      cornerStyles: {}
    };

    sketches.push({
      name: isFirst ? "Cuerpo Principal" : "Bloque Anexo",
      plane: "XY",
      offset: 0,
      profiles: [profile],
      operation: {
        type: "extrude",
        height: 20,
        taperScale: 1.0,
        booleanOp: isFirst ? "new-body" : "join"
      }
    });

    isFirst = false;

    // Erase the extracted rectangle
    for (let y = maxRect.y; y < maxRect.y + maxRect.h; y++) {
      for (let x = maxRect.x; x < maxRect.x + maxRect.w; x++) {
        if (grid[y * width + x] > 0) {
          grid[y * width + x] = 0;
          remainingArea--;
        }
      }
    }
  }

  // Safety net if decomposition yields nothing
  if (sketches.length === 0) {
    const outerReg = regularizeSketchLoop(outerLoop, scale, centerX, centerY, true);
    sketches.push({
      name: "Cuerpo Principal (Aproximación)",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: outerReg.type,
        points: outerReg.points,
        center: outerReg.center,
        radius: outerReg.radius,
        isClosed: true,
        cornerStyles: outerReg.cornerStyles
      }],
      operation: {
        type: "extrude",
        height: 20,
        taperScale: 1.0,
        booleanOp: "new-body"
      }
    });
  }
  
  // Add inner cavities (nested subtractive profiles)
  const cavities = nonBgComps.filter(c => c.label !== objectBodyLabel && c.size > 25);
  cavities.forEach((cav, idx) => {
    const cavGrid = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      cavGrid[i] = (labels[i] === cav.label) ? 255 : 0;
    }
    const cavSegments = marchingSquares(cavGrid, width, height);
    const cavLoops = assembleLoops(cavSegments);
    if (cavLoops.length > 0) {
      cavLoops.sort((a, b) => b.length - a.length);
      const cavReg = regularizeSketchLoop(cavLoops[0], scale, centerX, centerY, false);
      
      if (cavReg.points && cavReg.points.length >= 3 || cavReg.type === "circle") {
        sketches.push({
          name: `Agujero o Vaciado ${idx + 1}`,
          plane: "XY",
          offset: 0,
          profiles: [{
            type: cavReg.type,
            points: cavReg.points,
            center: cavReg.center,
            radius: cavReg.radius,
            isClosed: true,
            cornerStyles: cavReg.cornerStyles
          }],
          operation: {
            type: "extrude",
            height: 20,
            taperScale: 1.0,
            booleanOp: "cut"
          }
        });
      }
    }
  });
  
  return sketches;
}

async function extractMathematicalContours(base64Data: string): Promise<CADSketch[]> {
  const analysis = await analyzeImageContours(base64Data);
  return extractMathematicalContoursFromAnalysis(analysis);
}

async function generateContentWithFallback(ai: GoogleGenAI, options: { contents: any[] }) {
  const fallbackModels = [
    "gemini-2.5-flash-lite", 
    "gemini-2.5-flash", 
    "gemini-2.0-flash", 
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest"
  ];
  let lastError: any = null;
  for (const model of fallbackModels) {
    try {
      console.log(`Attempting reconstruction with model: ${model}`);
      const response = await ai.models.generateContent({
        model: model,
        contents: options.contents
      });
      console.log(`SUCCESS with model: ${model}`);
      return response;
    } catch (err: any) {
      console.warn(`FAILED with model ${model}:`, err.message || err);
      lastError = err;
    }
  }
  throw lastError || new Error("All models failed to generate content.");
}

export async function handleReconstruction(req: any, res: any) {
  try {
    const { image, images, textPrompt, mode, apiKey } = req.body;
    if (!textPrompt && !image && (!images || !Array.isArray(images) || images.length === 0)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Falta la imagen, el conjunto de imágenes o un texto descriptivo." }));
      return;
    }

    const geminiKey = apiKey || process.env.GEMINI_API_KEY;
    
    // Choose primary image for local mathematical fallback tracing (if an image exists)
    const primaryImage = (images && Array.isArray(images) && images.length > 0) ? images[0] : image;
    let mimeType = "image/png";
    let base64Data = "";
    
    if (primaryImage) {
      const matches = primaryImage.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
      base64Data = primaryImage;
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }

    if (mode === "mesh") {
      if (!geminiKey) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Falta la GEMINI_API_KEY. Configure la clave API en el archivo .env o en los ajustes." }));
        return;
      }
      
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const prompt = `Analiza la imagen o las imágenes adjuntas de esta pieza física y genera un modelo 3D en formato Wavefront OBJ de este objeto.
Sigue estrictamente estas reglas:
1. Si el objeto es un tetraedro (pirámide triangular), genera exactamente 4 vértices y 4 caras triangulares.
2. Si el objeto es una pirámide, cilindro, esfera, soporte L u otra forma geométrica o mecánica compleja, aproxímala con una malla limpia de vértices (líneas 'v x y z') y caras triangulares (líneas 'f v1 v2 v3').
3. Asegúrate de que las caras estén correctamente trianguladas y que los índices de los vértices en las caras sean correctos (empezando desde 1 y apuntando a los vértices válidos del archivo).
4. El modelo debe estar centrado alrededor del origen (0,0,0) y tener dimensiones realistas en milímetros (coordenadas de vértices en el rango de -50 a 50).
5. Asegúrate de que la malla sea completamente cerrada (watertight/estanca), sin agujeros ni aristas sueltas, y que las normales apunten hacia afuera (ordenando los vértices de las caras en sentido antihorario).
6. Devuelve ÚNICAMENTE el contenido del archivo OBJ. NO envuelvas la respuesta en bloques de código markdown (\`\`\`obj o similares) ni agregues ningún texto explicativo, comentarios ni encabezados adicionales.`;

      // Build dynamic multimodal parts array
      const parts: any[] = [{ text: prompt }];
      if (images && Array.isArray(images) && images.length > 0) {
        for (const img of images) {
          const imgMatches = img.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
          let mType = "image/png";
          let bData = img;
          if (imgMatches && imgMatches.length === 3) {
            mType = imgMatches[1];
            bData = imgMatches[2];
          }
          parts.push({
            inlineData: {
              mimeType: mType,
              data: bData
            }
          });
        }
      } else {
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }

      const response = await generateContentWithFallback(ai, {
        contents: [
          {
            role: "user",
            parts: parts
          }
        ]
      });

      let objText = response.text || "";
      objText = objText.replace(/```[a-zA-Z0-9]*\n/g, "").replace(/```/g, "").trim();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ mode: "mesh", objText }));
    } else {
      // Default: CAD Mode (using local mathematical image processing tracing algorithm + Gemini hybrid)
      console.log("Starting hybrid CAD mode reconstruction...");
      
      let analysis: any = null;
      let sketches: CADSketch[] = [];

      // 1. First, run the fast local mathematical contour analysis on the primary image to get bounds/center/shapes
      if (base64Data) {
        analysis = await analyzeImageContours(base64Data);
      }
      
      // 2. If Gemini API key is available, query Gemini to classify and mentally project the shape
      if (geminiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          
          let prompt = "";
          const commonPromptSteps = `
Paso 1: Identificación del Cuerpo Principal.
- Identifica la forma principal o base de la pieza. Este será el primer boceto de la línea de tiempo que establece el volumen inicial.
- Asigna obligatoriamente \`"booleanOp": "new-body"\`.

Paso 2: Inventario de Formas Secundarias.
- Identifica TODAS las formas secundarias que componen la pieza (agujeros, salientes, nervios, cajeras, etc.). Cuéntalas.
- Para cada forma secundaria, determina:
  a. Posición en la pieza: ¿Dónde está ubicada respecto al cuerpo principal? ¿Requiere un plano desplazado ("offset")?
  b. Simetrías: ¿Hay formas repetidas en patrón o simétricas?
  c. Forma y Tipo de Operación: ¿Es un vaciado sobre el cuerpo principal ("booleanOp": "cut") o es un sólido que hay que añadir ("booleanOp": "join")?

Paso 3: Rango Apropiado de Extrusión o Revolución.
- Analiza la profundidad, grosor o ángulo del objeto tridimensional visible en la foto.
- Calcula la altura de extrusión ("height") o ángulo de revolución de manera rigurosa y proporcional al tamaño de tus coordenadas 2D.
- Por ejemplo, si el ancho de la base 2D en tu boceto es de 60 mm y en la foto el grosor es un tercio de esa anchura, la extrusión resultante debe ser de unos 20 mm.
- No uses valores por defecto (como 20 o 25) arbitrariamente; adapta el rango de extrusión al espesor real visible de la pieza física.

Paso 4: Identificar Redondeos (Fillets) y Chaflanes (Chamfers) de Esquinas.
1. En las esquinas de los perfiles 2D (vértices del polígono): Identifica transiciones curvas (redondeos/fillets) o cortes diagonales planos (biseles/chaflanes/chamfers) y estima su radio/distancia en mm (ej. 2.0mm, 5.0mm).
2. En las caras 3D de extrusión global: Identifica si los bordes de la cara superior o inferior tienen redondeados o chaflanes de transición 3D (biselado superior/inferior).

Paso 5: Planificación de la Línea de Tiempo CAD Paso a Paso.
- Descompón la pieza en una serie ordenada de bocetos y operaciones.
- Haz CADA FORMA POR SEPARADO. Primero el cuerpo principal, y luego un boceto secundario para cada forma secundaria inventariada en el Paso 2.
- Asegúrate de asignar el plano y "offset" correctos para la posición de la forma, y el "booleanOp" correcto (cut o join).

Paso 6: Bucle de Validación y Verificación (Iterativo).
- Realiza pasos de identificación de lo que te falta por añadir, comprobando minuciosa e iterativamente contra la foto original.
- ¿Faltan agujeros secundarios, biseles, cajeras internas o redondeos? Si es así, añade los bocetos necesarios.
- Repite este proceso de verificación hasta que compruebes que no falta absolutamente nada por añadir y sea un trabajo preciso de ingeniería.

Paso 7: Trazar los perfiles 2D usando EXCLUSIVAMENTE formas predeterminadas.
- La inteligencia artificial debe identificar lógicamente la cara principal sobre la que hay que extruir o trabajar.
- Las piezas pueden tener muchos detalles, pero a nivel geométrico todos son simples.
- Usa SOLO combinaciones de formas predeterminadas ("circle", "rectangle", "triangle", "hexagon"). NO uses "polygon" para dibujar formas complejas vértice a vértice.
- Para construir figuras complejas, divídelas mentalmente en estas primitivas simples y posiciónalas correctamente con las dimensiones adecuadas ("radius" o calculando los "points" exactos). El truco es posicionarlos bien y con el tamaño adecuado.
- En la propiedad "cornerStyles", define un objeto JSON cuyas claves sean los índices (0-based) de los vértices que tienen redondeos o chaflanes y el valor sea \`{ "type": "fillet" | "chamfer", "size": número_en_mm }\`.

Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura, sin bloques de código markdown ni texto explicativo:
{
  "isSimple": true o false (true si es cubo, esfera, cilindro, cono o tetraedro estándar),
  "shape": "cube" | "sphere" | "cylinder" | "cone" | "tetrahedron" | "none",
  "isExtrusion": true o false,
  "hasPerspectiveVolume": true o false,
  "verificationChecklist": [
    "Identificación de la cara principal a extruir (ej: Cara Frontal)",
    "Identificación del cuerpo principal (ej: Base rectangular extrudida 30mm)",
    "Inventario de formas secundarias simples (ej: 4 círculos en las esquinas, 1 rectángulo central)",
    "Confirmación de que TODO está hecho con rectángulos, círculos, triángulos o hexágonos con su centro y tamaño perfectos"
  ],
  "sketches": [
    {
      "name": "Nombre descriptivo de la operación (ej. Base Rectangular, Agujero Circular)",
      "plane": "XY" | "XZ" | "YZ",
      "offset": número_desplazamiento_plano_en_mm,
      "profiles": [
        {
          "type": "circle" | "rectangle" | "triangle" | "hexagon",
          "points": [{"x": x_val, "y": y_val}, ...],
          "isClosed": true,
          "center": {"x": cx_val, "y": cy_val},
          "radius": r_val,
          "cornerStyles": {
            "0": { "type": "fillet", "size": 3.0 },
            "2": { "type": "chamfer", "size": 1.5 }
          }
        }
      ],
      "operation": {
        "type": "extrude" | "revolve",
        "height": número_altura_estimada,
        "booleanOp": "new-body" | "join" | "cut",
        "axis": "X" | "Y",
        "bevelType": "none" | "fillet" | "chamfer",
        "bevelSize": número_tamaño_bisel_en_mm
      }
    }
  ]
}

Si isSimple es true, pon "sketches": [], y en verificationChecklist pon ["Pieza simple clasificada"].`;

          if (textPrompt && (!images || images.length === 0) && !base64Data) {
            prompt = `Actúa como un Ingeniero de CAD experto. Tu tarea es generar la estructura paramétrica exacta de una pieza basándote PURA Y EXCLUSIVAMENTE en la siguiente descripción de texto del usuario: "${textPrompt}".
No vas a analizar ninguna imagen, debes "imaginar" la pieza e instanciarla paso a paso usando geometría paramétrica estricta.

${commonPromptSteps}`;
          } else if (textPrompt) {
            prompt = `El usuario ha proporcionado la siguiente descripción textual de la pieza: "${textPrompt}".
Analiza la(s) imagen(es) adjunta(s) de esta pieza física considerando esta descripción y clasifícala/reconstrúyela siguiendo estrictamente esta estrategia bien estructurada para piezas complejas, asegurando un trabajo preciso de ingeniería:

${commonPromptSteps}`;
          } else if (images && Array.isArray(images) && images.length > 1) {
            prompt = `Analiza las ${images.length} imágenes adjuntas del mismo objeto físico tomadas desde diferentes ángulos de cámara (inspirado en motores como Kiri Engine para mejorar el escaneo de fotos a un archivo STEP) y clasifícala/reconstrúyela siguiendo estrictamente esta estrategia bien estructurada para piezas complejas, asegurando un trabajo preciso de ingeniería:

${commonPromptSteps}`;
          } else {
            prompt = `Analiza la imagen adjunta de esta pieza física (inspirado en motores como Kiri Engine para mejorar el escaneo de fotos a un archivo STEP) y clasifícala/reconstrúyela siguiendo estrictamente esta estrategia bien estructurada para piezas complejas, asegurando un trabajo preciso de ingeniería:

${commonPromptSteps}`;
          }

          // Build dynamic multimodal parts array for CAD Mode
          const parts: any[] = [{ text: prompt }];
          
          if (images && Array.isArray(images) && images.length > 0) {
            for (const img of images) {
              const imgMatches = img.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
              let mType = "image/png";
              let bData = img;
              if (imgMatches && imgMatches.length === 3) {
                mType = imgMatches[1];
                bData = imgMatches[2];
              }
              parts.push({
                inlineData: {
                  mimeType: mType,
                  data: bData
                }
              });
            }
          } else if (base64Data) {
            parts.push({
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            });
          }

          const response = await generateContentWithFallback(ai, {
            contents: [
              {
                role: "user",
                parts: parts
              }
            ]
          });

          const text = response.text || "";
          const jsonStr = text.replace(/```[a-zA-Z0-9]*\n/g, "").replace(/```/g, "").trim();
          console.log("Gemini reconstruction response:", jsonStr);
          
          const parsed = JSON.parse(jsonStr);
          if (parsed) {
            console.log(`Step 1: Is Extrusion? ${parsed.isExtrusion}`);
            console.log(`Step 2: Has Perspective/Volume? ${parsed.hasPerspectiveVolume}`);
            
            if (parsed.isSimple && parsed.shape !== "none" && analysis) {
              console.log(`Gemini classified primitive: ${parsed.shape}. Generating mathematical primitive sketch...`);
              const primSketch = createPrimitiveSketch(parsed.shape as any, analysis.centerX, analysis.centerY, analysis.scale, analysis.maxDim);
              sketches = [primSketch];
            } else if (parsed.sketches && parsed.sketches.length > 0) {
              console.log(`Gemini returned ${parsed.sketches.length} custom sketches. Regularizing coordinates locally...`);
              sketches = parsed.sketches.map((sk: any) => regularizeSketch(sk));
            } else if (parsed.sketch) {
              console.log("Gemini returned single custom projected sketch. Regularizing coordinates locally...");
              sketches = [regularizeSketch(parsed.sketch)];
            }
          }
        } catch (err: any) {
          console.warn("Gemini reconstruction failed or timed out. Falling back to local classifier:", err.message || err);
        }
      }
      
      // 3. Fallback to local mathematical classifier & contour tracing if Gemini didn't return a primitive
      if (sketches.length === 0) {
        if (!analysis) {
          throw new Error("No se pudo generar la pieza desde el texto. Intenta proporcionar más detalles geométricos o medidas en tu descripción.");
        }
        console.log("Running local mathematical primitive classifier / contour-tracer...");
        const fallbackSketches = extractMathematicalContoursFromAnalysis(analysis);
        sketches = fallbackSketches;
      }
      
      console.log("CAD Mode reconstruction completed. Returning sketches count:", sketches.length);
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        mode: "cad",
        sketches: sketches
      }));
    }

  } catch (error: any) {
    console.error("Error in reconstruction backend:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message || "Error interno del servidor." }));
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import polygonClipping from 'polygon-clipping';
import { Point2D, Profile, SketchData } from "./types";

// Helper for distance between two points
export function distance(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function isPointInPolygon(point: Point2D, vs: Point2D[]): boolean {
  const x = point.x, y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y;
    const xj = vs[j].x, yj = vs[j].y;
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getPolygonArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

// Helper to determine winding order (CCW = true, CW = false)
export function isPolygonCCW(points: Point2D[]): boolean {
  return getPolygonArea(points) > 0;
}

// Helper to interpolate points for fillets/chamfers
export function getStyledPoints(
  points: Point2D[],
  cornerStyles: Record<number, { type: "none" | "fillet" | "chamfer"; size: number }> | undefined,
  isClosed: boolean,
  isHole: boolean = false
): Point2D[] {
  if (points.length < 3) return points;
  if (!cornerStyles || Object.keys(cornerStyles).length === 0) return points;

  const result: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const style = cornerStyles[i];

    // An open profile cannot fillet/chamfer its endpoints
    if (!isClosed && (i === 0 || i === points.length - 1)) {
      result.push(points[i]);
      continue;
    }

    if (!style || style.type === "none" || style.size <= 0) {
      result.push(points[i]);
      continue;
    }

    const prevIdx = (i - 1 + points.length) % points.length;
    const nextIdx = (i + 1) % points.length;

    const prevPt = points[prevIdx];
    const currPt = points[i];
    const nextPt = points[nextIdx];

    // Vector from curr to prev and curr to next
    const v1 = { x: prevPt.x - currPt.x, y: prevPt.y - currPt.y };
    const v2 = { x: nextPt.x - currPt.x, y: nextPt.y - currPt.y };

    const L1 = Math.hypot(v1.x, v1.y);
    const L2 = Math.hypot(v2.x, v2.y);

    if (L1 < 1e-4 || L2 < 1e-4) {
      result.push(currPt);
      continue;
    }

    // Normalized vectors
    const u1 = { x: v1.x / L1, y: v1.y / L1 };
    const u2 = { x: v2.x / L2, y: v2.y / L2 };

    const dot = u1.x * u2.x + u1.y * u2.y;
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const theta = Math.acos(clampedDot);

    if (theta < 1e-3 || theta > Math.PI - 1e-3) {
      result.push(currPt);
      continue;
    }

    const halfTheta = theta / 2;
    let T = style.type === "fillet" ? style.size / Math.tan(halfTheta) : style.size;
    const maxT = 0.45 * Math.min(L1, L2);
    if (T > maxT) T = maxT;
    const size = style.type === "fillet" ? T * Math.tan(halfTheta) : T;

    // Standard offset points
    const p1 = { x: currPt.x + T * u1.x, y: currPt.y + T * u1.y };
    const p2 = { x: currPt.x + T * u2.x, y: currPt.y + T * u2.y };

    if (isHole) {
      // In a hole (void inside solid), to REMOVE material from the solid, the hole boundary must EXPAND outwards at the corner.
      // The corner apex currPt is on the solid boundary. Expanding outwards means pushing away along the inverted bisector or adding a relief notch.
      const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
      const bisectorLen = Math.hypot(bisector.x, bisector.y);
      if (bisectorLen >= 1e-4) {
        const uB = { x: bisector.x / bisectorLen, y: bisector.y / bisectorLen };
        // Notch corner vertex outward into solid by size/sin(halfTheta)
        const D = (style.size * 0.707) / Math.max(0.2, Math.sin(halfTheta));
        const notchVertex = { x: currPt.x - D * uB.x, y: currPt.y - D * uB.y };

        if (style.type === "chamfer") {
          // Dog-bone V-notch chamfer: cuts material out of the corner into solid
          result.push(p1);
          result.push(notchVertex);
          result.push(p2);
        } else if (style.type === "fillet") {
          // Dog-bone circular relief: arc through notchVertex to smoothly relieve internal hole corner
          result.push(p1);
          // Interpolate smooth curve points through notch
          const midP1Notch = { x: (p1.x + notchVertex.x) / 2, y: (p1.y + notchVertex.y) / 2 };
          const midNotchP2 = { x: (notchVertex.x + p2.x) / 2, y: (notchVertex.y + p2.y) / 2 };
          result.push(midP1Notch);
          result.push(notchVertex);
          result.push(midNotchP2);
          result.push(p2);
        }
        continue;
      }
    }

    if (style.type === "chamfer") {
      result.push(p1);
      result.push(p2);
    } else if (style.type === "fillet") {
      const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
      const bisectorLen = Math.hypot(bisector.x, bisector.y);
      if (bisectorLen < 1e-4) {
        result.push(currPt);
        continue;
      }
      const uB = { x: bisector.x / bisectorLen, y: bisector.y / bisectorLen };
      const D = size / Math.sin(halfTheta);
      const center = { x: currPt.x + D * uB.x, y: currPt.y + D * uB.y };

      const w1 = { x: p1.x - center.x, y: p1.y - center.y };
      const w2 = { x: p2.x - center.x, y: p2.y - center.y };

      const theta1 = Math.atan2(w1.y, w1.x);
      const theta2 = Math.atan2(w2.y, w2.x);

      let dTheta = theta2 - theta1;
      if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      if (dTheta < -Math.PI) dTheta += 2 * Math.PI;

      const steps = Math.max(4, Math.floor(Math.abs(dTheta) / (Math.PI / 16)));

      for (let j = 0; j <= steps; j++) {
        const angle = theta1 + (j / steps) * dTheta;
        result.push({ x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) });
      }
    }
  }

  return result;
}

export function getStyledProfile(profile: Profile, isHole: boolean = false): Profile {
  if (profile.type === "circle") {
    return profile;
  }
  const styledPoints = getStyledPoints(profile.points, profile.cornerStyles, profile.isClosed, isHole);
  return {
    ...profile,
    points: styledPoints
  };
}

export function getStyledSketch(sketch: SketchData): SketchData {
  return sketch;
}

export function getSolidRegions(sketch: SketchData) {
  if (!sketch.profiles || sketch.profiles.length === 0) return [];

  // Build coordinate to style map from original closed profiles
  const styleMap = new Map<string, { type: "none" | "fillet" | "chamfer"; size: number }>();
  for (const profile of sketch.profiles) {
    if (profile.isClosed && profile.cornerStyles && profile.points) {
      for (const [idxStr, style] of Object.entries(profile.cornerStyles)) {
        const idx = parseInt(idxStr, 10);
        const pt = profile.points[idx];
        if (pt) {
          const key = `${pt.x.toFixed(4)},${pt.y.toFixed(4)}`;
          styleMap.set(key, style);
        }
      }
    }
  }

  // 1. Extract all segments
  const segments: Point2D[][] = [];
  for (const profile of sketch.profiles) {
    if (!profile.points || profile.points.length < 2) continue;
    for (let i = 0; i < profile.points.length - 1; i++) {
      segments.push([profile.points[i], profile.points[i+1]]);
    }
    if (profile.isClosed && profile.points.length > 2) {
      segments.push([profile.points[profile.points.length - 1], profile.points[0]]);
    }
  }

  // 2. Pad segments into thin polygons
  const padSegment = (p1: Point2D, p2: Point2D, thickness = 1e-5) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-8) return null;
    const nx = (-dy / len) * thickness;
    const ny = (dx / len) * thickness;
    return [[
      [p1.x + nx, p1.y + ny],
      [p2.x + nx, p2.y + ny],
      [p2.x - nx, p2.y - ny],
      [p1.x - nx, p1.y - ny]
    ]];
  };

  const padded = segments.map(s => padSegment(s[0], s[1])).filter(Boolean);
  if (padded.length === 0) return [];

  // 3. Union to create web
  let web: any[] = [];
  try {
    web = (polygonClipping.union as any)(...padded);
  } catch (err) {
    console.error("Web union failed", err);
    return [];
  }

  // 4. Extract holes as minimal planar faces
  const extractedProfiles: { points: Point2D[], isClosed: true }[] = [];
  for (const mp of web) {
    // ring 0 is outer boundary of the web. Rings 1..n are holes in the web, which represent bounded faces!
    for (let i = 1; i < mp.length; i++) {
      const ring = mp[i];
      const pts = ring.map((pt: any) => ({ x: pt[0], y: pt[1] }));
      if (pts.length > 0 && distance(pts[0], pts[pts.length - 1]) < 1e-4) pts.pop();
      if (pts.length >= 3) {
        extractedProfiles.push({ points: pts, isClosed: true });
      }
    }
  }

  if (extractedProfiles.length === 0) return [];

  // 5. Containment logic
  const containment = new Array(extractedProfiles.length).fill(0);
  for (let i = 0; i < extractedProfiles.length; i++) {
    const pI = extractedProfiles[i];
    const testPt = pI.points[0];
    
    for (let j = 0; j < extractedProfiles.length; j++) {
      if (i === j) continue;
      const pJ = extractedProfiles[j];
      // A small epsilon inset for testPt could be safer, but testPt is slightly inset by 1e-5 already!
      // Wait, testPt is exactly on the boundary of the hole, which is inset by 1e-5 from the original line.
      // Actually, if it's inside another face, it's fully inside.
      if (isPointInPolygon(testPt, pJ.points)) {
        containment[i]++;
      }
    }
  }

  const outers: any[] = [];
  const holes: any[] = [];
  for (let i = 0; i < extractedProfiles.length; i++) {
    const polyCoords = extractedProfiles[i].points.map(pt => [pt.x, pt.y]);
    if (polyCoords.length > 0) {
      polyCoords.push([...polyCoords[0]]);
    }
    const poly = [[polyCoords]];

    if (containment[i] % 2 === 0) {
      outers.push(poly);
    } else {
      holes.push(poly);
    }
  }

  // 6. Final Boolean to group holes into outers
  let finalPolygons: any[] = [];
  try {
    let unioned = outers.length > 0 ? (polygonClipping.union as any)(...outers) : [];
    if (holes.length > 0 && unioned.length > 0) {
      finalPolygons = (polygonClipping.difference as any)(unioned, ...holes);
    } else {
      finalPolygons = unioned;
    }
  } catch (err) {
    console.error("Polygon clipping failed, falling back", err);
    finalPolygons = outers;
  }

  const regions: any[] = [];
  
  for (const poly of finalPolygons) {
    if (!poly || poly.length === 0) continue;
    
    const buildProfile = (ring: any[], isHole: boolean): Profile => {
      let pts = ring.map((pt: any) => ({ x: pt[0], y: pt[1] }));
      if (pts.length > 0 && distance(pts[0], pts[pts.length - 1]) < 1e-4) {
        pts.pop();
      }
      
      const cornerStyles: Record<number, any> = {};
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        // The points might be shifted by 1e-5. We need a slightly larger tolerance for style matching.
        // Let's check a grid of points or just use distance.
        // Since we know styleMap keys are formatted to 4 decimals, 1e-5 shift won't affect toFixed(4)!
        const matchKeys = [
          `${pt.x.toFixed(4)},${pt.y.toFixed(4)}`,
          `${(pt.x + 0.0001).toFixed(4)},${pt.y.toFixed(4)}`,
          `${(pt.x - 0.0001).toFixed(4)},${pt.y.toFixed(4)}`,
          `${pt.x.toFixed(4)},${(pt.y + 0.0001).toFixed(4)}`,
          `${pt.x.toFixed(4)},${(pt.y - 0.0001).toFixed(4)}`
        ];
        
        for (const key of matchKeys) {
          if (styleMap.has(key)) {
            cornerStyles[i] = styleMap.get(key);
            break;
          }
        }
      }
      
      const rawProfile: Profile = {
        id: `merged-${Math.random().toString(36).substring(2)}`,
        type: "polygon",
        points: pts,
        isClosed: true,
        cornerStyles
      };
      
      return getStyledProfile(rawProfile, isHole);
    };

    const outerProfile = buildProfile(poly[0], false);
    const holeProfiles = poly.slice(1).map((ring: any) => buildProfile(ring, true));
    
    regions.push({ outerProfile, holeProfiles });
  }

  return regions;
}

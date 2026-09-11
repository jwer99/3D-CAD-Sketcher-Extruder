import { Matrix4, Mesh } from 'three';
import type { CADOperation, Point2D, Profile, SketchData } from '../types';

export type StepWire = { points: Point2D[] } | { center: Point2D; radius: number };
export type StepRecipe =
  | { kind: 'extrude'; height: number; regions: { outer: StepWire; holes: StepWire[] }[] }
  | { kind: 'transform'; matrix: number[]; source: StepRecipe }
  | { kind: 'boolean'; operation: 'cut' | 'join' | 'intersect'; left: StepRecipe; right: StepRecipe };

// Restore a circle only when the entire region wire matches the original circle
// samples. A clipped circle or a user-drawn polygon must retain its actual shape.
function wireForExport(profile: Profile, sketch: SketchData): StepWire {
  const circle = sketch.profiles.find(p => p.type === 'circle' && p.center && p.radius! > 0
    && p.points.length === profile.points.length
    && profile.points.every(a => p.points.some(b => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3)));
  return circle ? { center: { ...circle.center! }, radius: circle.radius! }
    : { points: profile.points.map(p => ({ ...p })) };
}

export function extrusionRecipe(regions: { outerProfile: Profile; holeProfiles: Profile[] }[],
  sketch: SketchData, parameters: Partial<CADOperation['parameters']>): StepRecipe | undefined {
  // Unsupported bevel/taper geometry stays on the mesh export path; never export
  // an unmodified prism in place of the actual edited part.
  if (((parameters.bevelType ?? 'fillet') !== 'none' && (parameters.bevelSize ?? 0.8) > 0)
    || (parameters.taperScale ?? 1) !== 1 || !parameters.height) return undefined;
  const source: StepRecipe = { kind: 'extrude', height: parameters.height,
    regions: regions.map(r => ({ outer: wireForExport(r.outerProfile, sketch),
      holes: r.holeProfiles.map(h => wireForExport(h, sketch)) })) };
  const rotation = new Matrix4();
  if (sketch.plane === 'XY') rotation.makeRotationX(-Math.PI / 2);
  if (sketch.plane === 'YZ') rotation.makeRotationY(-Math.PI / 2);
  return { kind: 'transform', matrix: rotation.toArray(), source };
}

export function worldStepRecipe(mesh: Mesh): StepRecipe | undefined {
  const source = mesh.geometry.userData.stepRecipe as StepRecipe | undefined;
  if (!source) return undefined;
  mesh.updateWorldMatrix(true, false);
  return { kind: 'transform', matrix: mesh.matrixWorld.toArray(), source };
}

/** Capture the exact successful CSG operation, in the result geometry's frame.
 * Metadata belongs to geometry so previews/replacements cannot leave stale recipes. */
export function booleanStepRecipe(target: Mesh, tool: Mesh,
  operation: 'cut' | 'join' | 'intersect'): StepRecipe | undefined {
  const left = worldStepRecipe(target), right = worldStepRecipe(tool);
  if (!left || !right) return undefined;
  return { kind: 'transform', matrix: target.matrixWorld.clone().invert().toArray(),
    source: { kind: 'boolean', operation, left, right } };
}

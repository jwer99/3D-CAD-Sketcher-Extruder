/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PlaneType = "XY" | "XZ" | "YZ";

export interface Point2D {
  x: number;
  y: number;
}

export type ProfileType = "polygon" | "rectangle" | "circle" | "hexagon" | "triangle";

export interface Profile {
  id: string;
  type: ProfileType;
  points: Point2D[]; // Array of points forming the shape (ordered)
  center?: Point2D;  // For circle helper
  radius?: number;   // For circle helper
  patternGroupId?: string;
  isClosed: boolean;
  cornerStyles?: Record<number, { type: "none" | "fillet" | "chamfer"; size: number }>;
}

export interface SketchData {
  id: string;
  name: string;
  plane: PlaneType;
  profiles: Profile[];
  offset?: number; // Distance offset from origin along the plane's normal in mm
  faceNormal?: [number, number, number]; // Outward normal vector from the selected face
  origin?: [number, number, number]; // 3D center point where the sketch was created
}

export type OperationType = "extrude" | "revolve" | "fillet" | "chamfer" | "boolean_solid";
export type BooleanOperation = "new-body" | "join" | "cut";

export interface CADOperation {
  id: string;
  name: string;
  type: OperationType;
  sketchId: string; // The sketch it is based on (or 'none' for pure solid ops)
  selectedShapeIndices?: number[]; // indices of shapes chosen for this operation
  parameters: {
    height: number; // for extrude, positive or negative
    angle: number;  // for revolve, in degrees (e.g. 360)
    axis: "X" | "Y"; // axis of revolve relative to sketch plane
    booleanOp: BooleanOperation;
    revolveAxisPoint1?: Point2D;
    revolveAxisPoint2?: Point2D;
    bevelType?: "none" | "fillet" | "chamfer";
    bevelSize?: number;
    taperScale?: number; // 0.0 (point/pyramid) to 1.0 (straight/prism)
    // New parameters for explicit boolean_solid operations
    targetSolidId?: string;
    toolSolidId?: string;
    booleanSolidOp?: "join" | "cut" | "intersect";
  };
}

export interface HistoryItem {
  id: string;
  type: "sketch" | "operation";
  refId: string; // ID of the sketch or operation
  name: string;
}

export interface MaterialStyle {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
}

export const PRESET_MATERIALS: MaterialStyle[] = [
  { id: "polished-steel", name: "Polished Steel", color: "#52525b", roughness: 0.35, metalness: 0.3, opacity: 1 },
  { id: "gold", name: "Gold", color: "#fbbf24", roughness: 0.15, metalness: 0.85, opacity: 1 },
  { id: "copper", name: "Copper", color: "#ea580c", roughness: 0.2, metalness: 0.9, opacity: 1 },
  { id: "anodized-blue", name: "Anodized Blue", color: "#2563eb", roughness: 0.3, metalness: 0.7, opacity: 1 },
  { id: "matte-plastic", name: "Matte Plastic", color: "#3f3f46", roughness: 0.8, metalness: 0.1, opacity: 1 },
  { id: "translucent-glass", name: "Glass (Clear)", color: "#e2e8f0", roughness: 0.1, metalness: 0.1, opacity: 0.5 },
];

export interface ImportedBody {
  id: string;
  name: string;
  vertices: number[] | Float32Array;
  normals?: number[] | Float32Array;
  indices?: number[] | Uint32Array | Uint16Array;
  color?: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number]; // in degrees
  scale?: [number, number, number];
  visible?: boolean;
  sourceId?: string;
  partIndex?: number;
  transformMatrix?: number[]; // 16 elements (4x4 matrix)
  groupTransformMatrix?: number[]; // 16 elements (4x4 group matrix)
}

export interface ImportedModelSource {
  sourceId: string;
  fileName: string;
  fileSize: number;
  partsCount: number;
  assetHash: string;
  assetUrl?: string;
  groupTransform?: {
    matrix: number[];
  };
}

export interface ProjectV2 {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sketches: Record<string, any>;
  operations: any[];
  activeSketchId?: string;
  activePlane?: string;
  material?: any;
  theme?: string;
  importedModels?: ImportedModelSource[];
  importedBodies?: ImportedBody[];
  meta?: {
    totalParts?: number;
    totalModels?: number;
    totalSizeBytes?: number;
  };
}



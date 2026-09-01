/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { 
  Box, 
  Sun, 
  Grid, 
  Eye, 
  RefreshCw, 
  Sparkles, 
  Compass, 
  SquareDot,
  Dices,
  Expand,
  Workflow,
  Share2,
  PenTool,
  Square,
  Circle,
  Triangle,
  Scissors,
  MousePointer2,
  Magnet,
  Maximize2,
  ChevronDown,
  X,
  Trash2
} from "lucide-react";
import { SketchData, CADOperation, MaterialStyle, PRESET_MATERIALS, PlaneType, Point2D, ImportedBody, ProfileType, Profile } from "../types";
import * as polygonClipping from "polygon-clipping";
import { getSolidRegions, isPointInPolygon } from "../GeometryUtils";
import { CSG } from "three-csg-ts";
import SketchPropertiesPanel from "./SketchPropertiesPanel";

export type SnapType = 'vertex' | 'midpoint' | 'center' | 'intersection' | 'edge' | 'parallel' | 'perpendicular' | 'grid' | 'none';

export type Guideline = 
  | { type: 'axis'; axis: 'x' | 'y'; value: number }
  | { type: 'angle'; p1: Point2D; p2: Point2D; snapType: 'parallel' | 'perpendicular' };

export interface SnapInfo {
  point: Point2D;
  type: SnapType;
  guides?: Guideline[];
}

function getPolygonArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function flipGeometryNormals(geometry: THREE.BufferGeometry) {
  const pos = geometry.attributes.position?.array;
  const norm = geometry.attributes.normal?.array;
  const uv = geometry.attributes.uv?.array;
  
  if (!pos) return;
  
  if (geometry.index) {
    const index = geometry.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i];
      index[i] = index[i + 2];
      index[i + 2] = tmp;
    }
  } else {
    for (let i = 0; i < pos.length; i += 9) {
      for (let j = 0; j < 3; j++) {
        const tmp = pos[i + j];
        pos[i + j] = pos[i + 6 + j];
        pos[i + 6 + j] = tmp;
        
        if (norm) {
          const tmpN = norm[i + j];
          norm[i + j] = norm[i + 6 + j];
          norm[i + 6 + j] = tmpN;
        }
      }
      if (uv) {
        for (let j = 0; j < 2; j++) {
          const uvI = (i / 3) * 2;
          const tmpU = uv[uvI + j];
          uv[uvI + j] = uv[uvI + 4 + j];
          uv[uvI + 4 + j] = tmpU;
        }
      }
    }
  }
  geometry.computeVertexNormals();
}

function enforceWindingOrder(ring: [number, number][], wantCW: boolean) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  const isCW = area < 0;
  if (wantCW !== isCW) {
    ring.reverse();
  }
}

const generateSolidGeometry = (
  shapes: THREE.Shape[],
  opType: "extrude" | "revolve",
  parameters: {
    height: number;
    angle: number;
    axis: "X" | "Y";
    revolveAxisPoint1?: Point2D;
    revolveAxisPoint2?: Point2D;
    bevelType?: "none" | "fillet" | "chamfer";
    bevelSize?: number;
    taperScale?: number;
  },
  rawSketch: SketchData
) => {
  let solidGeometry: THREE.BufferGeometry;
  const matchHeight = parameters.height;
  const matchAngle = parameters.angle;
  const p1 = parameters.revolveAxisPoint1;
  const p2 = parameters.revolveAxisPoint2;
  
  if (opType === "revolve") {
    const phiLength = (matchAngle / 360) * Math.PI * 2;
    const geometriesToMerge: THREE.BufferGeometry[] = [];
    
    const closePointsForLathe = (pts: THREE.Vector2[]) => {
      const res = [...pts];
      if (pts.length > 0) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-4) {
          res.push(first);
        }
      }
      return res;
    };
    
    const invertGeometryNormals = (geom: THREE.BufferGeometry) => {
      const index = geom.getIndex();
      if (index) {
        const array = index.array as any;
        for (let i = 0; i < array.length; i += 3) {
          const temp = array[i + 1];
          array[i + 1] = array[i + 2];
          array[i + 2] = temp;
        }
        index.needsUpdate = true;
      } else {
        const posAttr = geom.getAttribute("position");
        if (posAttr) {
          for (let i = 0; i < posAttr.count; i += 3) {
            const x1 = posAttr.getX(i + 1);
            const y1 = posAttr.getY(i + 1);
            const z1 = posAttr.getZ(i + 1);
            posAttr.setXYZ(i + 1, posAttr.getX(i + 2), posAttr.getY(i + 2), posAttr.getZ(i + 2));
            posAttr.setXYZ(i + 2, x1, y1, z1);
          }
          posAttr.needsUpdate = true;
        }
      }
      geom.computeVertexNormals();
    };
    
    if (p1 && p2) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const alpha = Math.PI / 2 - Math.atan2(dy, dx);
      
      const transformPt = (p: { x: number, y: number }) => {
        const tx = p.x - p1.x;
        const ty = p.y - p1.y;
        const rx = tx * Math.cos(alpha) - ty * Math.sin(alpha);
        const ry = tx * Math.sin(alpha) + ty * Math.cos(alpha);
        return new THREE.Vector2(rx, ry);
      };
      
      try {
        shapes.forEach(shape => {
          const { shape: rawPoints, holes: rawHoles } = shape.extractPoints(24);
          const localPoints = rawPoints.map(p => transformPt(p));
          const localHoles = rawHoles.map(h => h.map(p => transformPt(p)));
          
          const localShape = new THREE.Shape();
          if (localPoints.length > 0) {
            localShape.moveTo(localPoints[0].x, localPoints[0].y);
            for (let i = 1; i < localPoints.length; i++) {
              localShape.lineTo(localPoints[i].x, localPoints[i].y);
            }
            localShape.closePath();
          }
          
          localHoles.forEach(holeLoop => {
            if (holeLoop.length > 0) {
              const path = new THREE.Path();
              path.moveTo(holeLoop[0].x, holeLoop[0].y);
              for (let i = 1; i < holeLoop.length; i++) {
                path.lineTo(holeLoop[i].x, holeLoop[i].y);
              }
              path.closePath();
              localShape.holes.push(path);
            }
          });
          
          if (localPoints.length > 0) {
            const closedLocalPoints = closePointsForLathe(localPoints);
            geometriesToMerge.push(new THREE.LatheGeometry(closedLocalPoints, 36, 0, phiLength));
          }
          
          localHoles.forEach(holeLoop => {
            if (holeLoop.length > 0) {
              const closedHole = closePointsForLathe(holeLoop);
              const holeGeom = new THREE.LatheGeometry(closedHole, 36, 0, phiLength);
              invertGeometryNormals(holeGeom);
              geometriesToMerge.push(holeGeom);
            }
          });
          
          if (matchAngle < 360) {
            const cap1 = new THREE.ShapeGeometry(localShape);
            cap1.rotateY(-Math.PI / 2);
            const cap2 = new THREE.ShapeGeometry(localShape);
            cap2.scale(1, 1, -1);
            cap2.rotateY(phiLength - Math.PI / 2);
            geometriesToMerge.push(cap1, cap2);
          }
        });
        
        const merged = BufferGeometryUtils.mergeGeometries(geometriesToMerge, false);
        if (merged) {
          solidGeometry = merged;
        } else {
          throw new Error("Failed to merge custom axis geometries");
        }
      } catch (err) {
        console.error("Custom revolve merge failed, falling back", err);
        const defaultShape = shapes[0];
        const pts = defaultShape ? closePointsForLathe(defaultShape.extractPoints(24).shape.map(p => transformPt(p))) : [];
        solidGeometry = new THREE.LatheGeometry(pts, 36, 0, phiLength);
      }
      
      solidGeometry.rotateZ(-alpha);
      solidGeometry.translate(p1.x, p1.y, 0);
    } else {
      try {
        shapes.forEach(shape => {
          const { shape: points, holes } = shape.extractPoints(24);
          
          if (points.length > 0) {
            const closedPoints = closePointsForLathe(points.map(p => new THREE.Vector2(p.x, p.y)));
            geometriesToMerge.push(new THREE.LatheGeometry(closedPoints, 36, 0, phiLength));
          }
          
          holes.forEach(holeLoop => {
            if (holeLoop.length > 0) {
              const closedHole = closePointsForLathe(holeLoop.map(p => new THREE.Vector2(p.x, p.y)));
              const holeGeom = new THREE.LatheGeometry(closedHole, 36, 0, phiLength);
              invertGeometryNormals(holeGeom);
              geometriesToMerge.push(holeGeom);
            }
          });
          
          if (matchAngle < 360) {
            const cap1 = new THREE.ShapeGeometry(shape);
            cap1.rotateY(-Math.PI / 2);
            const cap2 = new THREE.ShapeGeometry(shape);
            cap2.scale(1, 1, -1);
            cap2.rotateY(phiLength - Math.PI / 2);
            geometriesToMerge.push(cap1, cap2);
          }
        });
        
        const merged = BufferGeometryUtils.mergeGeometries(geometriesToMerge, false);
        if (merged) {
          solidGeometry = merged;
        } else {
          throw new Error("Failed to merge default geometries");
        }
      } catch (err) {
        console.error("Default revolve merge failed, falling back", err);
        const defaultShape = shapes[0];
        const pts = defaultShape ? closePointsForLathe(defaultShape.extractPoints(24).shape.map(p => new THREE.Vector2(p.x, p.y))) : [];
        solidGeometry = new THREE.LatheGeometry(pts, 36, 0, phiLength);
      }
    }
  } else {
    const bevelType = parameters.bevelType ?? "fillet";
    const bevelSize = parameters.bevelSize ?? 0.8;
    
    let extrudeParams: any = {
      steps: 1
    };
    
    if (bevelType === "none" || bevelSize <= 0) {
      extrudeParams.bevelEnabled = false;
      extrudeParams.depth = matchHeight;
    } else {
      const t = bevelSize;
      const sign = Math.sign(matchHeight) || 1;
      const absHeight = Math.abs(matchHeight);
      const compensatedHeight = Math.max(0.1, absHeight - 2 * t);
      
      extrudeParams.bevelEnabled = true;
      extrudeParams.bevelThickness = t;
      extrudeParams.bevelSize = t;
      extrudeParams.bevelOffset = -t; // Prevent width/length expansion
      extrudeParams.bevelSegments = bevelType === "chamfer" ? 1 : 5;
      extrudeParams.depth = compensatedHeight * sign;
    }

    solidGeometry = new THREE.ExtrudeGeometry(shapes, extrudeParams);

    const taperScale = parameters.taperScale ?? 1.0;
    if (taperScale !== 1.0) {
      solidGeometry.computeBoundingBox();
      const bbox = solidGeometry.boundingBox;
      if (bbox) {
        const centerX = (bbox.min.x + bbox.max.x) / 2;
        const centerY = (bbox.min.y + bbox.max.y) / 2;
        const minZ = bbox.min.z;
        const maxZ = bbox.max.z;
        const depth = maxZ - minZ;
        const isNegative = matchHeight < 0;
        
        const posAttr = solidGeometry.getAttribute("position");
        if (posAttr && depth > 0) {
          const arr = posAttr.array as Float32Array;
          for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i];
            const y = arr[i + 1];
            const z = arr[i + 2];
            
            const u = isNegative
              ? Math.min(1, Math.max(0, (maxZ - z) / depth))
              : Math.min(1, Math.max(0, (z - minZ) / depth));
            const s = 1.0 - u * (1.0 - taperScale);
            
            arr[i] = centerX + (x - centerX) * s;
            arr[i + 1] = centerY + (y - centerY) * s;
          }
          posAttr.needsUpdate = true;
          solidGeometry.computeVertexNormals();
        }
      }
    }

    if (bevelType !== "none" && bevelSize > 0) {
      const t = bevelSize;
      const sign = Math.sign(matchHeight) || 1;
      solidGeometry.translate(0, 0, t * sign);
    }
    
    if (matchHeight < 0) {
      flipGeometryNormals(solidGeometry);
    }
  }
  
  if (rawSketch.plane === "XY") {
    solidGeometry.rotateX(-Math.PI / 2);
  } else if (rawSketch.plane === "YZ") {
    solidGeometry.rotateY(-Math.PI / 2);
  }
  
  return solidGeometry;
};

interface CADViewportProps {
  activeSketch: SketchData;
  sketches?: Record<string, SketchData>;
  operations: CADOperation[];
  material: MaterialStyle;
  onMeshCreated: (meshes: THREE.Mesh[]) => void;
  showEdgesOnly: boolean;
  setShowEdgesOnly: (show: boolean) => void;
  showSolid?: boolean;
  onFaceSelected?: (info: { plane: PlaneType; offset: number; faceNormal: number[]; point: number[] } | null) => void;
  selectedFaceInfo?: { plane: PlaneType; offset: number; faceNormal: number[]; point: number[] } | null;
  importedBodies?: ImportedBody[];
  onDeleteImportedBody?: (id: string) => void;
  onUpdateImportedBody?: (body: ImportedBody) => void;
  selectedShapeIndices: number[];
  onShapeClick: (index: number) => void;
  pendingOpType: "extrude" | "revolve";
  pendingHeight: number;
  pendingAngle: number;
  onConfirmOperation?: () => void;
  onCancelOperation?: () => void;
  onChangePendingOpType?: (type: "extrude" | "revolve") => void;
  onChangePendingHeight?: (height: number) => void;
  onChangePendingAngle?: (angle: number) => void;
  pendingRevolveAxisPoint1?: Point2D;
  pendingRevolveAxisPoint2?: Point2D;
  onChangePendingRevolveAxisPoint1?: (pt: Point2D) => void;
  onChangePendingRevolveAxisPoint2?: (pt: Point2D) => void;
  pendingBevelType?: "none" | "fillet" | "chamfer";
  pendingBevelSize?: number;
  onChangePendingBevelType?: (type: "none" | "fillet" | "chamfer") => void;
  onChangePendingBevelSize?: (size: number) => void;
  pendingTaperScale?: number;
  onChangePendingTaperScale?: (size: number) => void;
  pendingBooleanOp?: "new-body" | "join" | "cut";
  onSelectAllShapes?: () => void;
  edgeSelectionMode: boolean;
  selectedCorners: { profileId: string; vertexIndex: number }[];
  onToggleCornerSelection: (profileId: string, vertexIndex: number) => void;
  onUpdateSelectedCornersStyle: (type: "none" | "fillet" | "chamfer", size: number) => void;
  onClearSelectedCorners: () => void;
  
  theme?: "light" | "dark";
  onUpdateActiveSketch?: (sketch: SketchData) => void;
  onAddNewSketchOnFace?: (plane: PlaneType, offset: number, name?: string, faceNormal?: [number, number, number], origin?: [number, number, number]) => void;
  axisSelection?: boolean;
  onSelectAxisPoint?: (pt: Point2D) => void;
  activeRevolveAxis?: { p1: Point2D; p2: Point2D } | null;
  previousIntersectionSegments?: { p1: Point2D; p2: Point2D }[];
  activeSolidOp?: "none" | "join" | "cut" | "intersect";
  selectedTargetSolidId?: string | null;
  selectedToolSolidId?: string | null;
  onSolidSelect?: (solidId: string) => void;
  onConfirmSolidOp?: () => void;
  onCancelSolidOp?: () => void;
  onChangeActiveSolidOp?: (op: "none" | "join" | "cut" | "intersect") => void;
}


function solidRegionToShape(region: any) {
  const shape = new THREE.Shape();
  const outerPts = region.outerProfile?.points || region.outer || [];
  const holeProfs = region.holeProfiles || (region.holes ? region.holes.map((h: any) => ({ points: h })) : []);

  if (outerPts.length > 0) {
    shape.moveTo(outerPts[0].x, outerPts[0].y);
    for (let i = 1; i < outerPts.length; i++) {
      shape.lineTo(outerPts[i].x, outerPts[i].y);
    }
  }
  
  holeProfs.forEach((holeProf: any) => {
    const hole = holeProf.points || holeProf;
    if (hole.length > 0) {
      const holePath = new THREE.Path();
      holePath.moveTo(hole[0].x, hole[0].y);
      for (let i = 1; i < hole.length; i++) {
        holePath.lineTo(hole[i].x, hole[i].y);
      }
      shape.holes.push(holePath);
    }
  });
  return shape;
}

export default function CADViewport({
  activeSketch,
  sketches,
  operations,
  material,
  onMeshCreated,
  showEdgesOnly,
  setShowEdgesOnly,
  showSolid = true,
  onFaceSelected,
  selectedFaceInfo,
  importedBodies = [],
  onDeleteImportedBody,
  onUpdateImportedBody,
  selectedShapeIndices = [],
  onShapeClick,
  pendingOpType,
  pendingHeight,
  pendingAngle,
  onConfirmOperation,
  onCancelOperation,
  onChangePendingOpType,
  onChangePendingHeight,
  onChangePendingAngle,
  pendingRevolveAxisPoint1,
  pendingRevolveAxisPoint2,
  pendingBevelType = "none",
  pendingBevelSize = 1.0,
  onChangePendingBevelType,
  onChangePendingBevelSize,
  pendingTaperScale = 1.0,
  onChangePendingTaperScale,
  pendingBooleanOp = "new-body",
  onSelectAllShapes,
  edgeSelectionMode,
  selectedCorners,
  onToggleCornerSelection,
  onUpdateSelectedCornersStyle,
  onClearSelectedCorners,
  activeSolidOp = "none",
  selectedTargetSolidId,
  selectedToolSolidId,
  onSolidSelect,
  onConfirmSolidOp,
  onCancelSolidOp,
  onChangeActiveSolidOp,
  theme = "light",
  onUpdateActiveSketch,
  onAddNewSketchOnFace,
  axisSelection,
  onSelectAxisPoint,
  activeRevolveAxis,
  previousIntersectionSegments
}: CADViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const dynamicOverlayGroupRef = useRef<THREE.Group | null>(null);

  const onFaceSelectedRef = useRef(onFaceSelected);
  onFaceSelectedRef.current = onFaceSelected;
  const onShapeClickRef = useRef(onShapeClick);
  onShapeClickRef.current = onShapeClick;
  const onToggleCornerSelectionRef = useRef(onToggleCornerSelection);
  onToggleCornerSelectionRef.current = onToggleCornerSelection;

  const activeSolidOpRef = useRef(activeSolidOp);
  activeSolidOpRef.current = activeSolidOp;
  const selectedTargetSolidIdRef = useRef(selectedTargetSolidId);
  selectedTargetSolidIdRef.current = selectedTargetSolidId;
  const selectedToolSolidIdRef = useRef(selectedToolSolidId);
  selectedToolSolidIdRef.current = selectedToolSolidId;
  const onSolidSelectRef = useRef(onSolidSelect);
  onSolidSelectRef.current = onSolidSelect;

  const [activePreset, setActivePreset] = useState<string>("polished-steel");
  const [showGrid, setShowGrid] = useState(true);
  const [viewportTheme, setViewportTheme] = useState<"light" | "dark">("light");

  // State to control explicit sketch plane creation mode
  const [isFacePickMode, setIsFacePickMode] = useState<boolean>(false);
  const isFacePickModeRef = useRef(isFacePickMode);
  isFacePickModeRef.current = isFacePickMode;

  // Sketch Drawing State on 3D Plane
  const [tool, setTool] = useState<ProfileType | "select" | "line" | "trim" | "erase">("line");
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point2D[]>([]);
  const [tempEndPoint, setTempEndPoint] = useState<Point2D | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<Point2D | null>(null);
  const [activeSnapType, setActiveSnapType] = useState<SnapType>('none');
  const [activeGuides, setActiveGuides] = useState<Guideline[]>([]);
  const [isSelectingMirrorAxis, setIsSelectingMirrorAxis] = useState(false);
  const [customMirrorCopyState, setCustomMirrorCopyState] = useState(false);
  const [pendingMirrorPoints, setPendingMirrorPoints] = useState<Point2D[]>([]);
  const [osnapSettings, setOsnapSettings] = useState({
    grid: true, vertex: true, midpoint: true, center: true, intersection: true, edge: true, angle: true, guides: true
  });
  const [isOsnapMenuOpen, setIsOsnapMenuOpen] = useState(false);
  const [isDrawMenuOpen, setIsDrawMenuOpen] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<{ profileId: string, index: number } | null>(null);
  const [hoveredProfileId, setHoveredProfileId] = useState<string | null>(null);

  // Selected Imported STEP Bodies for Multi-Selection (Click + Ctrl or Selection Box), Move/Rotate/Scale/Delete
  const [selectedImportedBodyIds, setSelectedImportedBodyIds] = useState<string[]>([]);
  const selectedImportedBodyIdsRef = useRef(selectedImportedBodyIds);
  selectedImportedBodyIdsRef.current = selectedImportedBodyIds;

  // Box selection state on canvas
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const importedBodiesRef = useRef(importedBodies);
  importedBodiesRef.current = importedBodies;
  const onDeleteImportedBodyRef = useRef(onDeleteImportedBody);
  onDeleteImportedBodyRef.current = onDeleteImportedBody;
  const onUpdateImportedBodyRef = useRef(onUpdateImportedBody);
  onUpdateImportedBodyRef.current = onUpdateImportedBody;

  // Keep latest sketch & update callback in refs for mouse/keyboard handlers
  const activeSketchRef = useRef(activeSketch);
  activeSketchRef.current = activeSketch;
  const onUpdateActiveSketchRef = useRef(onUpdateActiveSketch);
  onUpdateActiveSketchRef.current = onUpdateActiveSketch;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const drawingPointsRef = useRef(drawingPoints);
  drawingPointsRef.current = drawingPoints;
  const selectedProfileIdsRef = useRef(selectedProfileIds);
  selectedProfileIdsRef.current = selectedProfileIds;
  const isSelectingMirrorAxisRef = useRef(isSelectingMirrorAxis);
  isSelectingMirrorAxisRef.current = isSelectingMirrorAxis;
  const pendingMirrorPointsRef = useRef(pendingMirrorPoints);
  pendingMirrorPointsRef.current = pendingMirrorPoints;
  const customMirrorCopyStateRef = useRef(customMirrorCopyState);
  customMirrorCopyStateRef.current = customMirrorCopyState;
  const osnapSettingsRef = useRef(osnapSettings);
  osnapSettingsRef.current = osnapSettings;
  const previousIntersectionSegmentsRef = useRef(previousIntersectionSegments);
  previousIntersectionSegmentsRef.current = previousIntersectionSegments;
  const axisSelectionRef = useRef(axisSelection);
  axisSelectionRef.current = axisSelection;
  const onSelectAxisPointRef = useRef(onSelectAxisPoint);
  onSelectAxisPointRef.current = onSelectAxisPoint;

  // Keyboard handler for delete and escape in 3D sketch mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        setDrawingPoints([]);
        setTempEndPoint(null);
        setIsSelectingMirrorAxis(false);
        setPendingMirrorPoints([]);
      }
      if (e.key === 'Enter') {
        const curPts = drawingPointsRef.current;
        const curSketch = activeSketchRef.current;
        const updateSketch = onUpdateActiveSketchRef.current;
        if (curPts.length >= 2 && curSketch && updateSketch) {
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "polygon",
            points: [...curPts],
            isClosed: false
          };
          updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          setDrawingPoints([]);
          setTempEndPoint(null);
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedImportedBodyIdsRef.current.length > 0 && onDeleteImportedBodyRef.current) {
          selectedImportedBodyIdsRef.current.forEach(id => onDeleteImportedBodyRef.current?.(id));
          setSelectedImportedBodyIds([]);
          return;
        }
        if (selectedProfileIdsRef.current.length > 0 && onUpdateActiveSketchRef.current && activeSketchRef.current) {
          onUpdateActiveSketchRef.current({
            ...activeSketchRef.current,
            profiles: activeSketchRef.current.profiles.filter(p => !selectedProfileIdsRef.current.includes(p.id))
          });
          setSelectedProfileIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Conversions between 3D plane coordinates and 2D CAD sketch coordinates (u, v)
  const clientToPlaneCAD = (clientX: number, clientY: number): SnapInfo & { worldPos: THREE.Vector3 } => {
    if (!rendererRef.current || !cameraRef.current || !activeSketchRef.current) {
      return { point: { x: 0, y: 0 }, type: 'none', guides: [], worldPos: new THREE.Vector3() };
    }

    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const mouseNdc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouseNdc, cameraRef.current);

    const planeType = activeSketchRef.current.plane;
    const offset = activeSketchRef.current.offset || 0;

    let threePlane = new THREE.Plane();
    if (planeType === "XY") {
      threePlane.setComponents(0, 1, 0, -offset);
    } else if (planeType === "XZ") {
      threePlane.setComponents(0, 0, 1, -offset);
    } else if (planeType === "YZ") {
      threePlane.setComponents(1, 0, 0, -offset);
    }

    const intersectPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(threePlane, intersectPoint);

    if (!hit) {
      return { point: { x: 0, y: 0 }, type: 'none', guides: [], worldPos: new THREE.Vector3() };
    }

    // Convert 3D world coordinates on plane to 2D local CAD sketch (x, y)
    let rawCadX = 0;
    let rawCadY = 0;
    if (planeType === "XY") {
      rawCadX = intersectPoint.x;
      rawCadY = -intersectPoint.z;
    } else if (planeType === "XZ") {
      rawCadX = intersectPoint.x;
      rawCadY = intersectPoint.y;
    } else if (planeType === "YZ") {
      rawCadX = intersectPoint.z;
      rawCadY = intersectPoint.y;
    }

    // OSNAP calculation
    let bestPointSnap: Point2D | null = null;
    let bestSnapType: SnapType = 'none';
    const cameraDist = cameraRef.current.position.distanceTo(intersectPoint);
    const snapDistanceThreshold = Math.max(1.5, cameraDist * 0.025);
    let minSnapDist = snapDistanceThreshold;

    const testCandidate = (pt: Point2D, type: SnapType) => {
      const dist = Math.hypot(rawCadX - pt.x, rawCadY - pt.y);
      if (dist < minSnapDist) {
        minSnapDist = dist;
        bestPointSnap = pt;
        bestSnapType = type;
      }
    };

    const curSketch = activeSketchRef.current;
    if (curSketch && curSketch.profiles) {
      curSketch.profiles.forEach((profile: any) => {
        if (profile.center && osnapSettingsRef.current.center) testCandidate(profile.center, 'center');
        if (profile.points) {
          profile.points.forEach((pt: Point2D, i: number) => {
            if (osnapSettingsRef.current.vertex) testCandidate(pt, 'vertex');
            if (osnapSettingsRef.current.midpoint && (profile.isClosed || i < profile.points.length - 1)) {
              const nextPt = profile.points[(i + 1) % profile.points.length];
              const midPt = { x: (pt.x + nextPt.x) / 2, y: (pt.y + nextPt.y) / 2 };
              testCandidate(midPt, 'midpoint');
            }
          });
        }
      });
    }

    if (previousIntersectionSegmentsRef.current) {
      previousIntersectionSegmentsRef.current.forEach((seg: { p1: Point2D; p2: Point2D }) => {
        if (osnapSettingsRef.current.vertex) {
          testCandidate(seg.p1, 'vertex');
          testCandidate(seg.p2, 'vertex');
        }
        if (osnapSettingsRef.current.midpoint) {
          testCandidate({ x: (seg.p1.x + seg.p2.x) / 2, y: (seg.p1.y + seg.p2.y) / 2 }, 'midpoint');
        }
      });
    }

    if (bestPointSnap) {
      return { 
        point: bestPointSnap, 
        type: bestSnapType, 
        guides: [],
        worldPos: intersectPoint
      };
    }

    let snapX = rawCadX;
    let snapY = rawCadY;
    let type: SnapType = 'none';
    const guides: Guideline[] = [];

    if (osnapSettingsRef.current.guides) {
      const candidates: Point2D[] = [...drawingPointsRef.current];
      candidates.push({ x: 0, y: 0 }); // Origin
      if (curSketch && curSketch.profiles) {
        curSketch.profiles.forEach((p: any) => {
          if (p.center) candidates.push(p.center);
          if (p.points) p.points.forEach((pt: Point2D) => candidates.push(pt));
        });
      }
      if (previousIntersectionSegmentsRef.current) {
        previousIntersectionSegmentsRef.current.forEach((seg: any) => {
          candidates.push(seg.p1);
          candidates.push(seg.p2);
        });
      }

      let bestGuideX: number | null = null;
      let minGuideDistX = snapDistanceThreshold * 0.6;
      let bestGuideY: number | null = null;
      let minGuideDistY = snapDistanceThreshold * 0.6;

      candidates.forEach(pt => {
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
      });

      if (bestGuideX !== null) {
        snapX = bestGuideX;
        guides.push({ type: 'axis', axis: 'x', value: bestGuideX });
      }
      if (bestGuideY !== null) {
        snapY = bestGuideY;
        guides.push({ type: 'axis', axis: 'y', value: bestGuideY });
      }
    }

    if (osnapSettingsRef.current.grid) {
      const gridSize = 10;
      const gridX = Math.round(snapX / gridSize) * gridSize;
      const gridY = Math.round(snapY / gridSize) * gridSize;
      if (Math.abs(snapX - gridX) < snapDistanceThreshold * 0.7 && Math.abs(snapY - gridY) < snapDistanceThreshold * 0.7) {
        snapX = gridX;
        snapY = gridY;
        type = 'grid';
      }
    }

    return { 
      point: { x: parseFloat(snapX.toFixed(2)), y: parseFloat(snapY.toFixed(2)) }, 
      type, 
      guides,
      worldPos: intersectPoint
    };
  };

  // Convert 2D CAD point on active sketch plane to 3D world position
  const cadPointToWorld = (pt: Point2D, zOffset: number = 0.15): THREE.Vector3 => {
    const plane = activeSketchRef.current?.plane || "XY";
    const offset = (activeSketchRef.current?.offset || 0) + zOffset;
    if (plane === "XY") {
      return new THREE.Vector3(pt.x, offset, -pt.y);
    } else if (plane === "XZ") {
      return new THREE.Vector3(pt.x, pt.y, offset);
    } else { // YZ
      return new THREE.Vector3(offset, pt.y, pt.x);
    }
  };

  // Initialize Scene, Camera, Lights, and Grid
  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      20000
    );
    camera.position.set(120, 100, 150);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0xf1f5f9, 1);
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Clear mount container first to avoid duplicating canvas on hot reload
    mountRef.current.innerHTML = "";
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Orbit Controls — tuned for ultra-smooth, fluid, and natural 3D CAD navigation
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;       // Ultra-smooth, natural inertia and fluid deceleration
    controls.rotateSpeed = 1.0;          // 1:1 responsive rotation tracking
    controls.zoomSpeed = 1.25;           // Smooth, progressive scroll zoom
    controls.panSpeed = 1.0;             // Responsive, natural screen-space panning
    controls.screenSpacePanning = true;  // Screen-space panning (standard in SolidWorks, Fusion 360, Blender)
    controls.minDistance = 1;            // Close-up inspection without clipping
    controls.maxDistance = 30000;        // Large assemblies support
    controls.maxPolarAngle = Math.PI;    // Full spherical freedom without lockups
    controls.minPolarAngle = 0;
    
    // Standard CAD mouse button configuration:
    // When in 3D Solid mode: Left Click rotates, Middle zooms, Right pans
    // When in 2D Sketch mode: Right Click / Alt+Left rotates 3D, Middle zooms/pans, Left Click draws/selects
    controls.mouseButtons = {
      LEFT: !showSolid ? -1 as any : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };

    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    controlsRef.current = controls;

    // 5. Ambient and Directional Studio Lights for Clean CAD Visualization
    const ambientLight = new THREE.AmbientLight("#ffffff", 1.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight("#ffffff", 1.4);
    dirLight1.position.set(300, 500, 300);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.bias = -0.0005; // Fix shadow acne on planar CAD surfaces
    dirLight1.shadow.normalBias = 0.05;
    dirLight1.shadow.camera.left = -1500;
    dirLight1.shadow.camera.right = 1500;
    dirLight1.shadow.camera.top = 1500;
    dirLight1.shadow.camera.bottom = -1500;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 4000;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight("#e2e8f0", 0.9); // Fill light from opposite side
    dirLight2.position.set(-300, 250, -300);
    scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight("#f8fafc", 0.6); // Front/bottom fill light to eliminate dark under-shading
    dirLight3.position.set(0, -200, 300);
    scene.add(dirLight3);

    // Dynamic light tracking the camera ("Headlight")
    const headlight = new THREE.PointLight("#ffffff", 0.8, 4000);
    scene.add(headlight);

    // Beautiful transparent shadow floor plane to capture realistic shadows under 3D parts
    const floorGeo = new THREE.PlaneGeometry(4000, 4000);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.18 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.5; // Lowered to eliminate z-fighting/clipping with the grid helper lines
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // 6. Ground Grid and Reference Coordinate Axes
    // Indigo-violet major line color (0x4f46e5) and slate minor grid line color (0x334155)
    const gridHelper = new THREE.GridHelper(1000, 100, viewportTheme === "light" ? 0x64748b : 0x4f46e5, viewportTheme === "light" ? 0xcbd5e1 : 0x334155);
    gridHelper.position.y = 0; // Set to absolute zero level
    if (gridHelper.material && !Array.isArray(gridHelper.material)) {
      const gridMat = gridHelper.material as THREE.LineBasicMaterial;
      gridMat.transparent = true;
      gridMat.opacity = 0.25;
    }
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(40);
    // Move slightly upwards and offset to prevent clipping the grids
    axesHelper.position.set(0, 0.1, 0);
    scene.add(axesHelper);

    // 7. Core Group to hold generated meshes and dynamic overlays
    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const dynamicOverlayGroup = new THREE.Group();
    scene.add(dynamicOverlayGroup);
    dynamicOverlayGroupRef.current = dynamicOverlayGroup;

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      
      // Update headlight position relative to camera
      headlight.position.copy(camera.position);

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Raycasting Face / Plane selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onCanvasClick = (event: MouseEvent) => {
      if (!mountRef.current || !renderer || !camera || !meshGroup) return;
      
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshGroup.children, true);

      if (intersects.length > 0) {
        // If we are in Solid Ops mode, prioritize selecting a solid
        if (activeSolidOpRef.current !== "none") {
          const solidIntersect = intersects.find(inst => inst.object.userData?.type === "solid" && inst.object.userData?.solidId);
          if (solidIntersect && onSolidSelectRef.current) {
            onSolidSelectRef.current(solidIntersect.object.userData.solidId);
          }
          return;
        }

        // First check if click was on an edge handle cylinder
        const edgeIntersect = intersects.find(inst => inst.object.userData?.type === "edge-handle");
        if (edgeIntersect) {
          const mesh = edgeIntersect.object as THREE.Mesh;
          const { profileId, vertexIndex } = mesh.userData;
          if (onToggleCornerSelectionRef.current) {
            onToggleCornerSelectionRef.current(profileId, vertexIndex);
          }
          return;
        }

        // Check if user clicked on a flat sketch profile area
        const flatIntersect = intersects.find(inst => inst.object.name.startsWith("sketch-profile-flat-"));
        if (flatIntersect) {
          const mesh = flatIntersect.object as THREE.Mesh;
          const idx = mesh.userData.index;
          if (onShapeClickRef.current) {
            onShapeClickRef.current(idx);
          }
          return;
        }

        // Only detect and select faces when the user explicitly clicks "Nuevo Plano de Boceto"
        if (isFacePickModeRef.current) {
          const intersect = intersects.find(inst => inst.object instanceof THREE.Mesh);
          if (intersect) {
            const mesh = intersect.object as THREE.Mesh;
            const point = intersect.point;
            let faceNormal = new THREE.Vector3(0, 1, 0);

            if (intersect.face && intersect.face.normal) {
              const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
              faceNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
            } else if (intersect.point && mesh.geometry) {
              // Fallback calculation for imported meshes without direct face normal
              const posAttr = mesh.geometry.getAttribute("position");
              if (intersect.faceIndex !== undefined && posAttr) {
                const iA = mesh.geometry.index ? mesh.geometry.index.getX(intersect.faceIndex * 3) : intersect.faceIndex * 3;
                const iB = mesh.geometry.index ? mesh.geometry.index.getX(intersect.faceIndex * 3 + 1) : intersect.faceIndex * 3 + 1;
                const iC = mesh.geometry.index ? mesh.geometry.index.getX(intersect.faceIndex * 3 + 2) : intersect.faceIndex * 3 + 2;

                const vA = new THREE.Vector3().fromBufferAttribute(posAttr, iA).applyMatrix4(mesh.matrixWorld);
                const vB = new THREE.Vector3().fromBufferAttribute(posAttr, iB).applyMatrix4(mesh.matrixWorld);
                const vC = new THREE.Vector3().fromBufferAttribute(posAttr, iC).applyMatrix4(mesh.matrixWorld);

                const cb = new THREE.Vector3().subVectors(vC, vB);
                const ab = new THREE.Vector3().subVectors(vA, vB);
                faceNormal = cb.cross(ab).normalize();
              }
            }
            
            let detectedPlane: PlaneType = "XY";
            let detectedOffset = 0;
            
            const absX = Math.abs(faceNormal.x);
            const absY = Math.abs(faceNormal.y);
            const absZ = Math.abs(faceNormal.z);
            
            if (absY >= absX && absY >= absZ) {
              detectedPlane = "XY";
              detectedOffset = point.y;
            } else if (absZ >= absX && absZ >= absY) {
              detectedPlane = "XZ";
              detectedOffset = point.z;
            } else {
              detectedPlane = "YZ";
              detectedOffset = point.x;
            }

            detectedOffset = Math.round(detectedOffset * 2) / 2;

            if (onFaceSelectedRef.current) {
              onFaceSelectedRef.current({
                plane: detectedPlane,
                offset: detectedOffset,
                faceNormal: [faceNormal.x, faceNormal.y, faceNormal.z],
                point: [point.x, point.y, point.z]
              });
            }
            // Automatically exit face pick mode once a face is chosen
            setIsFacePickMode(false);
          }
          return;
        }

        // Allow selecting and transforming imported STEP bodies when in "select" tool mode
        if (toolRef.current === "select") {
          const importedIntersect = intersects.find(inst => inst.object.userData?.type === "imported" && inst.object.userData?.bodyId);
          if (importedIntersect) {
            const bodyId = importedIntersect.object.userData.bodyId;
            const isCtrl = event.ctrlKey || event.metaKey || event.shiftKey;
            
            setSelectedImportedBodyIds(prev => {
              if (isCtrl) {
                // Toggle clicked body in multi-selection list
                return prev.includes(bodyId) ? prev.filter(id => id !== bodyId) : [...prev, bodyId];
              } else {
                // Single select
                return prev.includes(bodyId) && prev.length === 1 ? [] : [bodyId];
              }
            });
            return;
          } else {
            if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
              setSelectedImportedBodyIds([]);
            }
          }
        }
      } else {
        // click outside body clears selected face if in face pick mode and clears selected imported body
        if (isFacePickModeRef.current && onFaceSelectedRef.current) {
          onFaceSelectedRef.current(null);
        }
        if (toolRef.current === "select" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          setSelectedImportedBodyIds([]);
        }
      }
    };

    // Sketch drawing pointer handlers on 3D canvas
    const onSketchPointerDown = (e: PointerEvent) => {
      // Allow OrbitControls on right-click (2) or middle-click (1) or Alt+LeftClick
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        return;
      }
      if (e.button !== 0) return;

      const isSketchMode = !showSolid;
      if (!isSketchMode) return;

      const snapInfo = clientToPlaneCAD(e.clientX, e.clientY);
      const cadPoint = snapInfo.point;

      // Handle Revolve Axis picking
      if (axisSelectionRef.current && onSelectAxisPointRef.current) {
        onSelectAxisPointRef.current(cadPoint);
        return;
      }

      // Handle Mirror Axis picking
      if (isSelectingMirrorAxisRef.current && selectedProfileIdsRef.current.length >= 1 && activeSketchRef.current && onUpdateActiveSketchRef.current) {
        const newPoints = [...pendingMirrorPointsRef.current, cadPoint];
        if (newPoints.length === 1) {
          setPendingMirrorPoints(newPoints);
        } else if (newPoints.length === 2) {
          const p1 = newPoints[0];
          const p2 = newPoints[1];
          const profile = activeSketchRef.current.profiles.find(p => p.id === selectedProfileIdsRef.current[0]);
          if (profile) {
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const mirrorPoint = (pt: Point2D) => {
              const tx = pt.x - p1.x;
              const ty = pt.y - p1.y;
              const rx = tx * cos + ty * sin;
              const ry = -tx * sin + ty * cos;
              const mY = -ry;
              const bx = rx * cos - mY * sin;
              const by = rx * sin + mY * cos;
              return { x: parseFloat((bx + p1.x).toFixed(2)), y: parseFloat((by + p1.y).toFixed(2)) };
            };
            const newPointsArr = profile.points?.map(mirrorPoint);
            const newCenter = profile.center ? mirrorPoint(profile.center) : undefined;
            const isMirrorCopy = customMirrorCopyStateRef.current;
            const newProf: Profile = {
              ...profile,
              id: isMirrorCopy ? Math.random().toString(36).substr(2, 9) : profile.id,
              points: newPointsArr,
              center: newCenter
            };
            const updatedProfs = isMirrorCopy 
              ? [...activeSketchRef.current.profiles, newProf] 
              : activeSketchRef.current.profiles.map(p => p.id === profile.id ? newProf : p);
            onUpdateActiveSketchRef.current({ ...activeSketchRef.current, profiles: updatedProfs });
          }
          setIsSelectingMirrorAxis(false);
          setPendingMirrorPoints([]);
        }
        return;
      }

      // Drawing Tool Handlers
      const currentTool = toolRef.current;
      const curPts = drawingPointsRef.current;
      const curSketch = activeSketchRef.current;
      const updateSketch = onUpdateActiveSketchRef.current;

      // Handle Eraser / Delete Tool (Clicking on any sketch profile deletes it immediately)
      if (currentTool === "erase") {
        const profileToDelete = curSketch.profiles.find(p => {
          if (!p.points || p.points.length === 0) return false;
          // Check distance to any vertex or center
          if (p.center && Math.hypot(cadPoint.x - p.center.x, cadPoint.y - p.center.y) <= (p.radius || 10) + 3) {
            return true;
          }
          for (let i = 0; i < p.points.length; i++) {
            const p1 = p.points[i];
            const p2 = p.points[(i + 1) % p.points.length];
            // Point to segment distance
            const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) ** 2;
            if (l2 < 1e-4) {
              if (Math.hypot(cadPoint.x - p1.x, cadPoint.y - p1.y) < 5) return true;
              continue;
            }
            const t = Math.max(0, Math.min(1, ((cadPoint.x - p1.x) * (p2.x - p1.x) + (cadPoint.y - p1.y) * (p2.y - p1.y)) / l2));
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            if (Math.hypot(cadPoint.x - projX, cadPoint.y - projY) < 4) {
              return true;
            }
          }
          return false;
        });

        if (profileToDelete) {
          updateSketch({
            ...curSketch,
            profiles: curSketch.profiles.filter(p => p.id !== profileToDelete.id)
          });
          setSelectedProfileIds(prev => prev.filter(id => id !== profileToDelete.id));
        }
        return;
      }

      // Handle Select Tool for 2D profiles
      if (currentTool === "select") {
        const clickedProfile = curSketch.profiles.find(p => {
          if (!p.points || p.points.length === 0) return false;
          if (p.center && Math.hypot(cadPoint.x - p.center.x, cadPoint.y - p.center.y) <= (p.radius || 10) + 3) {
            return true;
          }
          for (let i = 0; i < p.points.length; i++) {
            const p1 = p.points[i];
            const p2 = p.points[(i + 1) % p.points.length];
            const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) ** 2;
            if (l2 < 1e-4) {
              if (Math.hypot(cadPoint.x - p1.x, cadPoint.y - p1.y) < 5) return true;
              continue;
            }
            const t = Math.max(0, Math.min(1, ((cadPoint.x - p1.x) * (p2.x - p1.x) + (cadPoint.y - p1.y) * (p2.y - p1.y)) / l2));
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            if (Math.hypot(cadPoint.x - projX, cadPoint.y - projY) < 4) {
              return true;
            }
          }
          return false;
        });

        const isCtrl = e.ctrlKey || e.metaKey || e.shiftKey;
        if (clickedProfile) {
          setSelectedProfileIds(prev => {
            if (isCtrl) {
              return prev.includes(clickedProfile.id) ? prev.filter(id => id !== clickedProfile.id) : [...prev, clickedProfile.id];
            } else {
              return prev.includes(clickedProfile.id) && prev.length === 1 ? [] : [clickedProfile.id];
            }
          });
        } else {
          if (!isCtrl) {
            setSelectedProfileIds([]);
          }
        }
        return;
      }

      if (currentTool === "line") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else {
          const firstPoint = curPts[0];
          const cameraDist = cameraRef.current?.position.distanceTo(new THREE.Vector3(0, 0, 0)) || 150;
          const closeThreshold = Math.max(3.0, cameraDist * 0.035);
          const isClosing = curPts.length >= 2 && Math.hypot(cadPoint.x - firstPoint.x, cadPoint.y - firstPoint.y) < closeThreshold;
          
          if (isClosing) {
            const newProfile: Profile = {
              id: Math.random().toString(36).substr(2, 9),
              type: "polygon",
              points: [...curPts],
              isClosed: true
            };
            updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
            setDrawingPoints([]);
            setTempEndPoint(null);
          } else {
            // Avoid adding identical consecutive points
            const lastPt = curPts[curPts.length - 1];
            if (Math.hypot(cadPoint.x - lastPt.x, cadPoint.y - lastPt.y) > 0.1) {
              setDrawingPoints([...curPts, cadPoint]);
            }
          }
        }
      } else if (currentTool === "rectangle") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else {
          const p1 = curPts[0];
          const p2 = cadPoint;
          const points: Point2D[] = [
            p1,
            { x: p2.x, y: p1.y },
            p2,
            { x: p1.x, y: p2.y }
          ];
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "rectangle",
            points,
            isClosed: true
          };
          updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          setDrawingPoints([]);
          setTempEndPoint(null);
        }
      } else if (currentTool === "circle") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else {
          const center = curPts[0];
          const radius = Math.hypot(cadPoint.x - center.x, cadPoint.y - center.y);
          const points: Point2D[] = [];
          for (let i = 0; i < 36; i++) {
            const angle = (i / 36) * Math.PI * 2;
            points.push({
              x: center.x + Math.cos(angle) * radius,
              y: center.y + Math.sin(angle) * radius
            });
          }
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "circle",
            points,
            center,
            radius,
            isClosed: true
          };
          updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          setDrawingPoints([]);
          setTempEndPoint(null);
        }
      } else if (currentTool === "triangle") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else {
          const p1 = curPts[0];
          const p2 = cadPoint;
          const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const points: Point2D[] = [
            { x: p1.x + radius * Math.cos(angle), y: p1.y + radius * Math.sin(angle) },
            { x: p1.x + radius * Math.cos(angle + (Math.PI * 2) / 3), y: p1.y + radius * Math.sin(angle + (Math.PI * 2) / 3) },
            { x: p1.x + radius * Math.cos(angle + 2 * (Math.PI * 2) / 3), y: p1.y + radius * Math.sin(angle + 2 * (Math.PI * 2) / 3) }
          ];
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "polygon",
            points,
            isClosed: true
          };
          updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          setDrawingPoints([]);
          setTempEndPoint(null);
        }
      }
    };

    let startX = 0;
    let startY = 0;
    let isBoxSelecting = false;

    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;

      // In 3D solid mode with select tool and left click (without alt), start selection box candidate
      if (showSolid && toolRef.current === "select" && e.button === 0 && !e.altKey) {
        isBoxSelecting = true;
      }

      onSketchPointerDown(e);
    };

    const onPointerUp = (e: PointerEvent) => {
      const diffX = Math.abs(e.clientX - startX);
      const diffY = Math.abs(e.clientY - startY);

      if (isBoxSelecting && (diffX >= 6 || diffY >= 6)) {
        // Selection window drag completed! Project 3D meshes to screen and find intersecting bodies
        if (renderer && camera && meshGroup) {
          const rect = renderer.domElement.getBoundingClientRect();
          const minX = Math.min(startX, e.clientX) - rect.left;
          const maxX = Math.max(startX, e.clientX) - rect.left;
          const minY = Math.min(startY, e.clientY) - rect.top;
          const maxY = Math.max(startY, e.clientY) - rect.top;

          const capturedBodyIds: string[] = [];
          const tempVec = new THREE.Vector3();

          meshGroup.traverse((child) => {
            if (child instanceof THREE.Mesh && child.userData?.type === "imported" && child.userData?.bodyId) {
              const bodyId = child.userData.bodyId;
              // Check if geometry bounding center or vertices are inside screen rectangle
              if (!child.geometry.boundingBox) {
                child.geometry.computeBoundingBox();
              }
              const bbox = child.geometry.boundingBox;
              if (bbox) {
                bbox.getCenter(tempVec);
                tempVec.applyMatrix4(child.matrixWorld);
                tempVec.project(camera);

                // Convert NDC to screen coords
                const sx = ((tempVec.x + 1) / 2) * rect.width;
                const sy = ((-tempVec.y + 1) / 2) * rect.height;

                if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY && tempVec.z >= -1 && tempVec.z <= 1) {
                  if (!capturedBodyIds.includes(bodyId)) {
                    capturedBodyIds.push(bodyId);
                  }
                }
              }
            }
          });

          const isCtrl = e.ctrlKey || e.metaKey || e.shiftKey;
          setSelectedImportedBodyIds(prev => {
            if (isCtrl) {
              const combined = new Set([...prev, ...capturedBodyIds]);
              return Array.from(combined);
            } else {
              return capturedBodyIds;
            }
          });
        }
        setSelectionBox(null);
        isBoxSelecting = false;
        return;
      }

      setSelectionBox(null);
      isBoxSelecting = false;

      if (diffX < 4 && diffY < 4) {
        onCanvasClick(e);
      }
    };

    let hoveredObject: THREE.Object3D | null = null;

    const onPointerMove = (event: PointerEvent) => {
      if (!mountRef.current || !renderer || !camera || !meshGroup) return;

      if (isBoxSelecting) {
        const diffX = Math.abs(event.clientX - startX);
        const diffY = Math.abs(event.clientY - startY);
        if (diffX > 4 || diffY > 4) {
          setSelectionBox({
            startX,
            startY,
            currentX: event.clientX,
            currentY: event.clientY
          });
        }
      }

      const isSketchMode = !showSolid;
      if (isSketchMode) {
        const snapInfo = clientToPlaneCAD(event.clientX, event.clientY);
        setHoveredPoint(snapInfo.point);
        setActiveSnapType(snapInfo.type);
        setActiveGuides(snapInfo.guides || []);

        if (drawingPointsRef.current.length > 0) {
          setTempEndPoint(snapInfo.point);
        } else {
          setTempEndPoint(null);
        }
      }

      // Only perform heavy full-mesh raycasting on pointer move if in select mode or picking a face/edge
      const shouldRaycastHover = isFacePickModeRef.current || toolRef.current === "select" || edgeSelectionMode;
      if (shouldRaycastHover) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(meshGroup.children, true);

        let foundInteractive = false;
        let targetIntersect: THREE.Object3D | null = null;

        if (intersects.length > 0) {
          const edgeIntersect = intersects.find(inst => inst.object.userData?.type === "edge-handle");
          const flatIntersect = intersects.find(inst => inst.object.name.startsWith("sketch-profile-flat-"));

          if (edgeIntersect) {
            targetIntersect = edgeIntersect.object;
            foundInteractive = true;
          } else if (flatIntersect) {
            targetIntersect = flatIntersect.object;
            foundInteractive = true;
          } else if (isFacePickModeRef.current) {
            const faceIntersect = intersects.find(inst => inst.object instanceof THREE.Mesh);
            if (faceIntersect) {
              targetIntersect = faceIntersect.object;
            }
          }
        }

        // Restore previously hovered object color/opacity
        if (hoveredObject && hoveredObject !== targetIntersect) {
          if (hoveredObject.userData?.type === "edge-handle") {
            const mat = (hoveredObject as THREE.Mesh).material as THREE.MeshBasicMaterial;
            const isSelected = hoveredObject.userData?.selected;
            mat.opacity = isSelected ? 0.75 : 0.25;
            mat.color?.setHex(isSelected ? 0xf59e0b : 0x3b82f6);
          } else if (hoveredObject.name.startsWith("sketch-profile-flat-")) {
            const mat = (hoveredObject as THREE.Mesh).material as THREE.MeshBasicMaterial;
            const isSelected = hoveredObject.userData?.selected;
            mat.opacity = isSelected ? 0.6 : 0.2;
            mat.color?.setHex(isSelected ? 0xf59e0b : 0x3b82f6);
          }
          hoveredObject = null;
        }

        if (foundInteractive && targetIntersect) {
          renderer.domElement.style.cursor = "pointer";
          if (targetIntersect !== hoveredObject) {
            hoveredObject = targetIntersect;
            if (targetIntersect.userData?.type === "edge-handle") {
              const mat = (targetIntersect as THREE.Mesh).material as THREE.MeshBasicMaterial;
              mat.opacity = 0.95;
              mat.color?.setHex(0xf59e0b); // bright orange on hover
            } else if (targetIntersect.name.startsWith("sketch-profile-flat-")) {
              const mat = (targetIntersect as THREE.Mesh).material as THREE.MeshBasicMaterial;
              mat.opacity = 0.55;
              mat.color?.setHex(0x10b981); // elegant emerald green on hover
            }
          }
        } else {
          renderer.domElement.style.cursor = isSketchMode ? "crosshair" : (isFacePickModeRef.current ? "pointer" : "default");
        }
      } else {
        renderer.domElement.style.cursor = isSketchMode ? "crosshair" : "default";
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // High-fidelity Resize Observer for responsive viewport sizing when panels scale or collapse
    const resizeObserver = new ResizeObserver(() => {
      if (!mountRef.current || !camera || !renderer) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mountRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Only if not typing in an input
        if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
          return;
        }
        if (!showSolid && selectedProfileIdsRef.current.length > 0 && activeSketchRef.current && onUpdateActiveSketchRef.current) {
          const toDelete = selectedProfileIdsRef.current;
          onUpdateActiveSketchRef.current({
            ...activeSketchRef.current,
            profiles: activeSketchRef.current.profiles.filter(p => !toDelete.includes(p.id))
          });
          setSelectedProfileIds([]);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    const canvasEl = renderer.domElement;
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      renderer.dispose();
    };
  }, []);

  // Update Geometry whenever sketch data or operations modify
  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return;

    // Remove existing meshes
    while (meshGroup.children.length > 0) {
      const child = meshGroup.children[0];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      meshGroup.remove(child);
    }

    const exportedMeshes: THREE.Mesh[] = [];
    const renderedSolids: THREE.Mesh[] = [];

    // Base Material definition
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(material.color),
      roughness: material.roughness,
      metalness: material.metalness,
      transparent: showEdgesOnly || material.opacity < 1,
      opacity: showEdgesOnly ? 0.4 : material.opacity,
      wireframe: showEdgesOnly,
      side: THREE.DoubleSide
    });

    // Dark wireframe edge material
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: "#09090b",
      linewidth: 2
    });

    // Render sketches (both saved profiles and in-progress 2D drawing)
    const sketchArray = sketches 
      ? Object.values(sketches) 
      : [activeSketch];

    sketchArray.forEach((rawSketch) => {
      const isCurrentSketchActive = rawSketch.id === activeSketch.id;
      const shouldRenderSolid = !isCurrentSketchActive || showSolid;

      // Draw 2D profiles and in-progress drawing elements in 3D viewport ONLY when in sketch mode
      if (!shouldRenderSolid) {
        rawSketch.profiles.forEach(profile => {
            if (profile.points.length === 0) return;
            const points3D = profile.points.map(p => new THREE.Vector3(p.x, p.y, 0));
            if (profile.isClosed) {
              points3D.push(points3D[0].clone()); // Close loop
            }
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points3D);
            
            if (rawSketch.plane === "XY") {
              lineGeo.rotateX(-Math.PI / 2);
            } else if (rawSketch.plane === "YZ") {
              lineGeo.rotateY(-Math.PI / 2);
            }

            const isSelected = selectedProfileIds.includes(profile.id);
            const outlineMat = new THREE.LineBasicMaterial({
              color: isSelected ? 0x2563eb : (isCurrentSketchActive ? 0x3b82f6 : 0x94a3b8),
              linewidth: isSelected ? 3.5 : (isCurrentSketchActive ? 2.5 : 1.5)
            });
            const outlineLine = new THREE.Line(lineGeo, outlineMat);
            
            // Apply construction offset to 2D wire outline
            const offset = (rawSketch as any).offset || 0;
            if (rawSketch.plane === "XY") {
              outlineLine.position.y += offset + 0.08;
            } else if (rawSketch.plane === "XZ") {
              outlineLine.position.z += offset + 0.08;
            } else if (rawSketch.plane === "YZ") {
              outlineLine.position.x += offset + 0.08;
            }
            
            meshGroup.add(outlineLine);

            // Render profile vertex points for precision feedback
            profile.points.forEach(pt => {
              const ptGeo = new THREE.SphereGeometry(1.2, 8, 8);
              const ptMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0x2563eb : 0x3b82f6 });
              const ptMesh = new THREE.Mesh(ptGeo, ptMat);
              ptMesh.position.copy(cadPointToWorld(pt, 0.1));
              meshGroup.add(ptMesh);
            });
          });

        }

        if (shouldRenderSolid) {
          const regions = getSolidRegions(rawSketch);
          if (regions.length > 0) {
            const op = operations.find(o => o.sketchId === rawSketch.id);
            const matchHeight = op?.parameters.height ?? 25;
            const matchAngle = op?.parameters.angle ?? 360;
            const opType = (op?.type === "revolve" ? "revolve" : "extrude") as "extrude" | "revolve";

            let selectedRegions = regions;
            if (op?.selectedShapeIndices && op.selectedShapeIndices.length > 0) {
              selectedRegions = op.selectedShapeIndices
                .map(idx => regions[idx])
                .filter(Boolean);
            }

            const shapesToExtrude = selectedRegions.map(r => solidRegionToShape(r));

            if (shapesToExtrude.length > 0) {
              const solidGeometry = generateSolidGeometry(
                shapesToExtrude,
                opType,
                {
                  height: matchHeight,
                  angle: matchAngle,
                  axis: "Y",
                  revolveAxisPoint1: op?.parameters.revolveAxisPoint1,
                  revolveAxisPoint2: op?.parameters.revolveAxisPoint2,
                  bevelType: op?.parameters.bevelType,
                  bevelSize: op?.parameters.bevelSize,
                  taperScale: op?.parameters.taperScale
                },
                rawSketch
              );

              const isCutOp = op?.parameters.booleanOp === "cut";
              let meshMaterial = baseMaterial.clone();
              if (isCutOp) {
                meshMaterial = new THREE.MeshStandardMaterial({
                  color: 0xef4444, // semi-transparent red for cut operations
                  roughness: 0.8,
                  metalness: 0.1,
                  transparent: true,
                  opacity: 0.5,
                  side: THREE.DoubleSide,
                  depthWrite: false
                });
              } else if (activeSolidOpRef.current !== "none") {
                if (op?.id === selectedTargetSolidIdRef.current) {
                  meshMaterial.emissive = new THREE.Color(0x3b82f6);
                  meshMaterial.emissiveIntensity = 0.6;
                } else if (op?.id === selectedToolSolidIdRef.current) {
                  meshMaterial.emissive = new THREE.Color(0xf59e0b);
                  meshMaterial.emissiveIntensity = 0.6;
                }
              }

              const solidMesh = new THREE.Mesh(solidGeometry, meshMaterial);
              solidMesh.userData = { type: "solid", sketchId: rawSketch.id, operationId: op?.id, solidId: op?.id };

              const offset = rawSketch.offset || 0;
              if (rawSketch.plane === "XY") {
                solidMesh.position.y += offset;
              } else if (rawSketch.plane === "XZ") {
                solidMesh.position.z += offset;
              } else if (rawSketch.plane === "YZ") {
                solidMesh.position.x += offset;
              }

              solidMesh.castShadow = true;
              solidMesh.receiveShadow = true;

              if (isCutOp) {
                // Nudge slightly to avoid CSG coplanar face bugs
                solidMesh.position.add(new THREE.Vector3(0.001, 0.001, 0.001));

                // Perform Boolean Cut subtraction using CSG
                try {
                  solidMesh.updateMatrix();
                  solidMesh.updateMatrixWorld(true);
                  const cutCSG = CSG.fromMesh(solidMesh);

                  renderedSolids.forEach(prevMesh => {
                    try {
                      prevMesh.updateMatrix();
                      prevMesh.updateMatrixWorld(true);
                      const bodyCSG = CSG.fromMesh(prevMesh);
                      const subtractedCSG = bodyCSG.subtract(cutCSG);
                      const tempMesh = CSG.toMesh(subtractedCSG, prevMesh.matrixWorld, prevMesh.material as THREE.Material);
                      
                      prevMesh.geometry.dispose();
                      prevMesh.geometry = tempMesh.geometry;

                      // Re-generate outline
                      const oldOutline = prevMesh.children.find(child => child instanceof THREE.LineSegments);
                      if (oldOutline) {
                        prevMesh.remove(oldOutline);
                        if (!showEdgesOnly) {
                          const edgesGeo = new THREE.EdgesGeometry(prevMesh.geometry, 35);
                          const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                          prevMesh.add(edgeLines);
                        }
                      }
                    } catch (csgSubErr) {
                      console.error("Failed to subtract geometry chunk:", csgSubErr);
                    }
                  });
                } catch (csgErr) {
                  console.error("CSG initialization failed for cut tool:", csgErr);
                }

                // Only render the cut tool itself if it's the currently active sketch's solid operation
                if (isCurrentSketchActive) {
                  meshGroup.add(solidMesh);
                  if (!showEdgesOnly) {
                    const edgesGeo = new THREE.EdgesGeometry(solidGeometry, 35);
                    const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                    solidMesh.add(edgeLines);
                  }
                }
              } else if (op?.parameters.booleanOp === "join" && renderedSolids.length > 0) {
                // Perform Boolean Union using CSG
                try {
                  solidMesh.updateMatrix();
                  solidMesh.updateMatrixWorld(true);
                  const joinCSG = CSG.fromMesh(solidMesh);

                  // Join with the first available solid (acting as base body)
                  const prevMesh = renderedSolids[0];
                  prevMesh.updateMatrix();
                  prevMesh.updateMatrixWorld(true);
                  const bodyCSG = CSG.fromMesh(prevMesh);
                  const unionedCSG = bodyCSG.union(joinCSG);
                  const tempMesh = CSG.toMesh(unionedCSG, prevMesh.matrixWorld, prevMesh.material as THREE.Material);
                  
                  prevMesh.geometry.dispose();
                  prevMesh.geometry = tempMesh.geometry;

                  const oldOutline = prevMesh.children.find(child => child instanceof THREE.LineSegments);
                  if (oldOutline) {
                    prevMesh.remove(oldOutline);
                    if (!showEdgesOnly) {
                      const edgesGeo = new THREE.EdgesGeometry(prevMesh.geometry, 35);
                      const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                      prevMesh.add(edgeLines);
                    }
                  }
                } catch (err) {
                  console.error("CSG union failed:", err);
                  meshGroup.add(solidMesh);
                  renderedSolids.push(solidMesh);
                  exportedMeshes.push(solidMesh);
                  if (!showEdgesOnly) {
                    const edgesGeo = new THREE.EdgesGeometry(solidGeometry, 35);
                    const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                    solidMesh.add(edgeLines);
                  }
                }
              } else {
                meshGroup.add(solidMesh);
                renderedSolids.push(solidMesh);
                exportedMeshes.push(solidMesh);

                if (!showEdgesOnly) {
                  const edgesGeo = new THREE.EdgesGeometry(solidGeometry, 35);
                  const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                  solidMesh.add(edgeLines);
                }
              }
            }
          }
        } else {
          if (isCurrentSketchActive) {
            const regions = getSolidRegions(rawSketch);
            regions.forEach((region, regionIdx) => {
              const flatGeometry = new THREE.ShapeGeometry(solidRegionToShape(region));

              if (rawSketch.plane === "XY") {
                flatGeometry.rotateX(-Math.PI / 2);
              } else if (rawSketch.plane === "YZ") {
                flatGeometry.rotateY(-Math.PI / 2);
              }

              const isSelected = selectedShapeIndices.includes(regionIdx);
              const flatMaterial = new THREE.MeshBasicMaterial({
                color: isSelected ? 0xf59e0b : 0x3b82f6,
                transparent: true,
                opacity: isSelected ? 0.6 : 0.2,
                side: THREE.DoubleSide,
                depthWrite: false
              });

              const flatMesh = new THREE.Mesh(flatGeometry, flatMaterial);
              flatMesh.name = `sketch-profile-flat-${regionIdx}`;
              flatMesh.userData = { index: regionIdx, selected: isSelected };

              const offset = rawSketch.offset || 0;
              const zOffset = 0.1;
              if (rawSketch.plane === "XY") {
                flatMesh.position.set(0, offset + zOffset, 0);
              } else if (rawSketch.plane === "XZ") {
                flatMesh.position.set(0, 0, offset + zOffset);
              } else if (rawSketch.plane === "YZ") {
                flatMesh.position.set(offset + zOffset, 0, 0);
              }

              meshGroup.add(flatMesh);

              const edges = new THREE.EdgesGeometry(flatGeometry);
              const outlineLine = new THREE.LineSegments(
                edges,
                new THREE.LineBasicMaterial({
                  color: isSelected ? 0xf59e0b : 0x3b82f6,
                  linewidth: 2
                })
              );
              flatMesh.add(outlineLine);
            });

            if (selectedShapeIndices.length > 0) {
              const selectedShapes = selectedShapeIndices
                .map(idx => regions[idx] ? solidRegionToShape(regions[idx]) : null)
                .filter((s): s is THREE.Shape => s !== null);

              if (selectedShapes.length > 0) {
                const activeOp = operations.find(o => o.sketchId === rawSketch.id);
                const previewGeom = generateSolidGeometry(
                  selectedShapes,
                  pendingOpType,
                  {
                    height: pendingHeight,
                    angle: pendingAngle,
                    axis: "Y",
                    revolveAxisPoint1: pendingRevolveAxisPoint1 ?? activeOp?.parameters.revolveAxisPoint1,
                    revolveAxisPoint2: pendingRevolveAxisPoint2 ?? activeOp?.parameters.revolveAxisPoint2,
                    bevelType: pendingBevelType,
                    bevelSize: pendingBevelSize,
                    taperScale: pendingTaperScale
                  },
                  rawSketch
                );

                const isCutPreview = pendingBooleanOp === "cut";

                const previewMaterial = new THREE.MeshStandardMaterial({
                  color: isCutPreview ? 0xef4444 : 0xf59e0b,
                  transparent: true,
                  opacity: isCutPreview ? 0.5 : 0.45,
                  roughness: 0.2,
                  metalness: 0.5,
                  side: THREE.DoubleSide,
                  depthWrite: false
                });

                const previewMesh = new THREE.Mesh(previewGeom, previewMaterial);
                previewMesh.name = "operation-preview";

                const offset = rawSketch.offset || 0;
                if (rawSketch.plane === "XY") {
                  previewMesh.position.y += offset;
                } else if (rawSketch.plane === "XZ") {
                  previewMesh.position.z += offset;
                } else if (rawSketch.plane === "YZ") {
                  previewMesh.position.x += offset;
                }

                meshGroup.add(previewMesh);

                if (isCutPreview) {
                  try {
                    // Nudge slightly to avoid CSG coplanar face bugs
                    previewMesh.position.add(new THREE.Vector3(0.001, 0.001, 0.001));

                    previewMesh.updateMatrix();
                    previewMesh.updateMatrixWorld(true);
                    const cutCSG = CSG.fromMesh(previewMesh);

                    renderedSolids.forEach(prevMesh => {
                      try {
                        prevMesh.updateMatrix();
                        prevMesh.updateMatrixWorld(true);
                        const bodyCSG = CSG.fromMesh(prevMesh);
                        const subtractedCSG = bodyCSG.subtract(cutCSG);
                        const tempMesh = CSG.toMesh(subtractedCSG, prevMesh.matrixWorld, prevMesh.material as THREE.Material);
                        
                        prevMesh.geometry = tempMesh.geometry;

                        // Update outline
                        const oldOutline = prevMesh.children.find(child => child instanceof THREE.LineSegments);
                        if (oldOutline) {
                          prevMesh.remove(oldOutline);
                          if (!showEdgesOnly) {
                            const edgesGeo = new THREE.EdgesGeometry(prevMesh.geometry, 35);
                            const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                            prevMesh.add(edgeLines);
                          }
                        }
                      } catch (subErr) {
                        console.error("Preview subtraction failed on chunk:", subErr);
                      }
                    });
                  } catch (csgErr) {
                    console.error("Preview CSG failed:", csgErr);
                  }
                } else if (pendingBooleanOp === "join" && renderedSolids.length > 0) {
                  try {
                    previewMesh.updateMatrix();
                    previewMesh.updateMatrixWorld(true);
                    const joinCSG = CSG.fromMesh(previewMesh);
                    const prevMesh = renderedSolids[0];
                    
                    prevMesh.updateMatrix();
                    prevMesh.updateMatrixWorld(true);
                    const bodyCSG = CSG.fromMesh(prevMesh);
                    const unionedCSG = bodyCSG.union(joinCSG);
                    const tempMesh = CSG.toMesh(unionedCSG, prevMesh.matrixWorld, prevMesh.material as THREE.Material);
                    
                    prevMesh.geometry = tempMesh.geometry;
                    const oldOutline = prevMesh.children.find(child => child instanceof THREE.LineSegments);
                    if (oldOutline) {
                      prevMesh.remove(oldOutline);
                      if (!showEdgesOnly) {
                        const edgesGeo = new THREE.EdgesGeometry(prevMesh.geometry, 35);
                        const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                        prevMesh.add(edgeLines);
                      }
                    }
                    
                    // We don't render the standalone preview mesh heavily since it's merged, but we can keep its wireframe
                    previewMesh.visible = false; 
                  } catch (err) {
                    console.error("Preview union failed:", err);
                  }
                }

                const edgesGeo = new THREE.EdgesGeometry(previewGeom, 35);
                const previewOutline = new THREE.LineSegments(
                  edgesGeo,
                  new THREE.LineBasicMaterial({ color: isCutPreview ? 0xef4444 : 0xf59e0b, linewidth: 1.5 })
                );
                previewMesh.add(previewOutline);
              }
            }
          }
        }

        // Render interactive edge-selection handles (cylinders) along vertical edges
        if (edgeSelectionMode && isCurrentSketchActive) {
          rawSketch.profiles.forEach(profile => {
            if (!profile.isClosed || profile.points.length < 3) return;
            if (profile.type === "circle") return;

            const op = operations.find(o => o.sketchId === rawSketch.id);
            const matchHeight = op?.parameters.height ?? (pendingHeight !== undefined ? pendingHeight : 25);
            const absHeight = Math.abs(matchHeight);
            const offset = rawSketch.offset || 0;

            profile.points.forEach((pt, idx) => {
              const cylRadius = 2.5;
              const cylHeight = absHeight;
              const handleGeo = new THREE.CylinderGeometry(cylRadius, cylRadius, cylHeight, 16);

              const isSelected = selectedCorners.some(
                c => c.profileId === profile.id && c.vertexIndex === idx
              );

              const handleMat = new THREE.MeshBasicMaterial({
                color: isSelected ? 0xf59e0b : 0x3b82f6, // bright orange if selected, elegant blue if normal
                transparent: true,
                opacity: isSelected ? 0.75 : 0.25,
                depthWrite: false
              });

              const handleMesh = new THREE.Mesh(handleGeo, handleMat);
              handleMesh.userData = { type: "edge-handle", profileId: profile.id, vertexIndex: idx, selected: isSelected };

              if (rawSketch.plane === "XY") {
                handleMesh.position.set(pt.x, offset + matchHeight / 2, -pt.y);
              } else if (rawSketch.plane === "XZ") {
                handleMesh.position.set(pt.x, pt.y, offset + matchHeight / 2);
                handleMesh.rotation.x = Math.PI / 2;
              } else if (rawSketch.plane === "YZ") {
                handleMesh.position.set(offset + matchHeight / 2, pt.y, pt.x);
                handleMesh.rotation.z = Math.PI / 2;
              }

              meshGroup.add(handleMesh);
            });
          });
        }
      });

    // Render glowing interface grid on selected plane face centered at the exact clicked 3D point
    if (selectedFaceInfo) {
      const helperPlaneGeo = new THREE.PlaneGeometry(80, 80);
      const helperPlaneMat = new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide
      });
      const helperMesh = new THREE.Mesh(helperPlaneGeo, helperPlaneMat);
      helperMesh.name = "helper-face-plane";
      
      const planeGrid = new THREE.GridHelper(80, 8, 0x60a5fa, 0x3b82f6);
      const pt = selectedFaceInfo.point || [0, 0, 0];
      
      if (selectedFaceInfo.plane === "XY") {
        helperMesh.rotation.x = -Math.PI / 2;
        helperMesh.position.set(pt[0], selectedFaceInfo.offset, pt[2]);
        planeGrid.position.set(pt[0], selectedFaceInfo.offset, pt[2]);
      } else if (selectedFaceInfo.plane === "XZ") {
        helperMesh.position.set(pt[0], pt[1], selectedFaceInfo.offset);
        planeGrid.rotation.x = Math.PI / 2;
        planeGrid.position.set(pt[0], pt[1], selectedFaceInfo.offset);
      } else if (selectedFaceInfo.plane === "YZ") {
        helperMesh.rotation.y = -Math.PI / 2;
        helperMesh.position.set(selectedFaceInfo.offset, pt[1], pt[2]);
        planeGrid.rotation.z = Math.PI / 2;
        planeGrid.position.set(selectedFaceInfo.offset, pt[1], pt[2]);
      }
      
      const planeEdges = new THREE.EdgesGeometry(helperPlaneGeo);
      const planeLines = new THREE.LineSegments(
        planeEdges,
        new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2.5 })
      );
      helperMesh.add(planeLines);
      
      meshGroup.add(helperMesh);
      meshGroup.add(planeGrid);
    }

    // Render glowing helper grid/plane for the active 2D sketch plane centered at sketch origin
    if (activeSketch) {
      const planeType = activeSketch.plane;
      const offset = activeSketch.offset || 0;
      const orig = activeSketch.origin || [0, 0, 0];
      
      const activePlaneGeo = new THREE.PlaneGeometry(160, 160);
      const activePlaneMat = new THREE.MeshBasicMaterial({
        color: 0x10b981, // Emerald green for active sketch plane alignment
        transparent: true,
        opacity: 0.04, // Very subtle, elegant overlay
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const activePlaneMesh = new THREE.Mesh(activePlaneGeo, activePlaneMat);
      activePlaneMesh.name = "active-sketch-plane-helper";
      
      const activePlaneGrid = new THREE.GridHelper(160, 16, 0x10b981, 0x059669);
      if (Array.isArray(activePlaneGrid.material)) {
        activePlaneGrid.material.forEach(m => {
          m.transparent = true;
          m.opacity = 0.15;
        });
      } else {
        activePlaneGrid.material.transparent = true;
        activePlaneGrid.material.opacity = 0.15;
      }
      
      if (planeType === "XY") {
        activePlaneMesh.rotation.x = -Math.PI / 2;
        activePlaneMesh.position.set(orig[0], offset, orig[2]);
        activePlaneGrid.position.set(orig[0], offset, orig[2]);
      } else if (planeType === "XZ") {
        activePlaneMesh.position.set(orig[0], orig[1], offset);
        activePlaneGrid.rotation.x = Math.PI / 2;
        activePlaneGrid.position.set(orig[0], orig[1], offset);
      } else if (planeType === "YZ") {
        activePlaneMesh.rotation.y = -Math.PI / 2;
        activePlaneMesh.position.set(offset, orig[1], orig[2]);
        activePlaneGrid.rotation.z = Math.PI / 2;
        activePlaneGrid.position.set(offset, orig[1], orig[2]);
      }
      
      const activePlaneEdges = new THREE.EdgesGeometry(activePlaneGeo);
      const activePlaneLines = new THREE.LineSegments(
        activePlaneEdges,
        new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 1.5, transparent: true, opacity: 0.35 })
      );
      activePlaneMesh.add(activePlaneLines);
      
      meshGroup.add(activePlaneMesh);
      meshGroup.add(activePlaneGrid);
    }

    // Process explicit solid-to-solid boolean operations in chronological order
    const solidBooleanOps = operations.filter(op => op.type === "boolean_solid");
    solidBooleanOps.forEach(op => {
      const { targetSolidId, toolSolidId, booleanSolidOp } = op.parameters;
      if (!targetSolidId || !toolSolidId || !booleanSolidOp) return;

      const targetMeshIdx = renderedSolids.findIndex(m => m.userData?.solidId === targetSolidId);
      const toolMeshIdx = renderedSolids.findIndex(m => m.userData?.solidId === toolSolidId);

      if (targetMeshIdx !== -1 && toolMeshIdx !== -1) {
        const targetMesh = renderedSolids[targetMeshIdx];
        const toolMesh = renderedSolids[toolMeshIdx];

        try {
          targetMesh.updateMatrix();
          targetMesh.updateMatrixWorld(true);
          toolMesh.updateMatrix();
          toolMesh.updateMatrixWorld(true);

          const targetCSG = CSG.fromMesh(targetMesh);
          const toolCSG = CSG.fromMesh(toolMesh);

          let resultCSG;
          if (booleanSolidOp === "cut") {
            resultCSG = targetCSG.subtract(toolCSG);
          } else if (booleanSolidOp === "join") {
            resultCSG = targetCSG.union(toolCSG);
          } else if (booleanSolidOp === "intersect") {
            resultCSG = targetCSG.intersect(toolCSG);
          }

          if (resultCSG) {
            const tempMesh = CSG.toMesh(resultCSG, targetMesh.matrixWorld, targetMesh.material as THREE.Material);
            
            if (targetMesh.geometry) targetMesh.geometry.dispose();
            targetMesh.geometry = tempMesh.geometry;

            // Remove tool mesh from renderedSolids, exportedMeshes and meshGroup
            renderedSolids.splice(toolMeshIdx, 1);
            meshGroup.remove(toolMesh);
            const expIdx = exportedMeshes.findIndex(m => m === toolMesh);
            if (expIdx !== -1) exportedMeshes.splice(expIdx, 1);
            if (toolMesh.geometry) toolMesh.geometry.dispose();

            // Re-add outline to targetMesh
            if (!showEdgesOnly) {
              const oldOutline = targetMesh.children.find(child => child instanceof THREE.LineSegments);
              if (oldOutline) {
                targetMesh.remove(oldOutline);
                (oldOutline as any).geometry?.dispose();
                (oldOutline as any).material?.dispose();
              }
              const edgesGeo = new THREE.EdgesGeometry(targetMesh.geometry, 35);
              const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
              targetMesh.add(edgeLines);
            }
          }
        } catch (err) {
          console.error("Solid Boolean Op failed:", err);
        }
      }
    });

    // Render imported bodies in the scene
    if (importedBodies && importedBodies.length > 0) {
      importedBodies.forEach((body) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(body.vertices, 3));
        
        if (body.normals && body.normals.length > 0) {
          geom.setAttribute("normal", new THREE.Float32BufferAttribute(body.normals, 3));
        } else {
          geom.computeVertexNormals();
        }

        if (body.indices && body.indices.length > 0) {
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(body.indices), 1));
        }

        const isSelectedBody = selectedImportedBodyIds.includes(body.id);
        const bodyMat = body.color ? new THREE.MeshStandardMaterial({
          color: new THREE.Color(body.color[0], body.color[1], body.color[2]),
          roughness: 0.35,
          metalness: 0.25,
          side: THREE.DoubleSide,
          emissive: isSelectedBody ? new THREE.Color(0x3b82f6) : new THREE.Color(0x000000),
          emissiveIntensity: isSelectedBody ? 0.45 : 0.0
        }) : new THREE.MeshStandardMaterial({
          color: material.color,
          roughness: material.roughness,
          metalness: material.metalness,
          transparent: material.opacity < 1,
          opacity: material.opacity,
          side: THREE.DoubleSide,
          emissive: isSelectedBody ? new THREE.Color(0x3b82f6) : new THREE.Color(0x000000),
          emissiveIntensity: isSelectedBody ? 0.45 : 0.0
        });

        const mesh = new THREE.Mesh(geom, bodyMat);
        mesh.userData = { type: "imported", bodyId: body.id };
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = body.name;

        // Apply transformations (position, rotation, scale)
        if (body.position) {
          mesh.position.set(body.position[0], body.position[1], body.position[2]);
        }
        if (body.rotation) {
          mesh.rotation.set(
            (body.rotation[0] * Math.PI) / 180,
            (body.rotation[1] * Math.PI) / 180,
            (body.rotation[2] * Math.PI) / 180
          );
        }
        if (body.scale) {
          mesh.scale.set(body.scale[0], body.scale[1], body.scale[2]);
        }

        // For massive assemblies, skip edge lines computation to avoid WebGL memory exhaustion (OOM tab crash)
        const vertCount = geom.getAttribute("position") ? geom.getAttribute("position").count : 0;
        if (showEdgesOnly || vertCount < 80000) {
          const edges = new THREE.EdgesGeometry(geom, 40);
          const line = new THREE.LineSegments(edges, isSelectedBody ? new THREE.LineBasicMaterial({ color: "#60a5fa", linewidth: 2.5 }) : edgeMaterial);
          mesh.add(line);
        }

        meshGroup.add(mesh);
        exportedMeshes.push(mesh);
      });
    }

    // Callback so the parent state holds the updated THREE Meshes for STEP export
    onMeshCreated(exportedMeshes);

  }, [
    activeSketch,
    sketches,
    operations,
    material,
    showEdgesOnly,
    showSolid,
    selectedFaceInfo,
    importedBodies,
    selectedShapeIndices,
    pendingOpType,
    pendingHeight,
    pendingAngle,
    pendingRevolveAxisPoint1,
    pendingRevolveAxisPoint2,
    pendingBevelType,
    pendingBevelSize,
    pendingTaperScale,
    edgeSelectionMode,
    selectedCorners,
    selectedProfileIds,
    selectedImportedBodyIds
  ]);

  // Lightweight useEffect dedicated ONLY to real-time 60fps sketch rubberband and OSNAP guides
  useEffect(() => {
    const dynamicGroup = dynamicOverlayGroupRef.current;
    if (!dynamicGroup) return;

    // Clear previous lightweight overlays
    while (dynamicGroup.children.length > 0) {
      const child = dynamicGroup.children[0];
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      dynamicGroup.remove(child);
    }

    if (showSolid || !activeSketch) return;

    // Render active in-progress drawing lines (rubberband) in 3D
    if (drawingPoints.length > 0) {
      const activePts = [...drawingPoints];
      if (tempEndPoint) {
        if (tool === "rectangle") {
          const p1 = activePts[0];
          const p2 = tempEndPoint;
          activePts.push({ x: p2.x, y: p1.y }, p2, { x: p1.x, y: p2.y }, p1);
        } else if (tool === "circle") {
          const center = activePts[0];
          const radius = Math.hypot(tempEndPoint.x - center.x, tempEndPoint.y - center.y);
          const circlePts: Point2D[] = [];
          for (let i = 0; i <= 36; i++) {
            const angle = (i / 36) * Math.PI * 2;
            circlePts.push({
              x: center.x + Math.cos(angle) * radius,
              y: center.y + Math.sin(angle) * radius
            });
          }
          activePts.length = 0;
          activePts.push(...circlePts);
        } else if (tool === "triangle") {
          const p1 = activePts[0];
          const p2 = tempEndPoint;
          const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          activePts.length = 0;
          activePts.push(
            { x: p1.x + radius * Math.cos(angle), y: p1.y + radius * Math.sin(angle) },
            { x: p1.x + radius * Math.cos(angle + (Math.PI * 2) / 3), y: p1.y + radius * Math.sin(angle + (Math.PI * 2) / 3) },
            { x: p1.x + radius * Math.cos(angle + 2 * (Math.PI * 2) / 3), y: p1.y + radius * Math.sin(angle + 2 * (Math.PI * 2) / 3) },
            { x: p1.x + radius * Math.cos(angle), y: p1.y + radius * Math.sin(angle) }
          );
        } else {
          activePts.push(tempEndPoint);
        }
      }

      if (activePts.length >= 2) {
        const activeGeo = new THREE.BufferGeometry().setFromPoints(
          activePts.map(pt => cadPointToWorld(pt, 0.12))
        );
        const activeMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2.5 });
        dynamicGroup.add(new THREE.Line(activeGeo, activeMat));
      }

      // Draw vertex handles for drawn points
      drawingPoints.forEach((pt, i) => {
        const nodeGeo = new THREE.SphereGeometry(i === 0 ? 1.8 : 1.2, 12, 12);
        const nodeMat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0x10b981 : 0x3b82f6 });
        const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
        nodeMesh.position.copy(cadPointToWorld(pt, 0.15));
        dynamicGroup.add(nodeMesh);
      });
    }

    // Render active OSNAP guides and hover indicator in 3D
    if (hoveredPoint) {
      const snapGeo = new THREE.RingGeometry(1.6, 2.4, 16);
      if (activeSketch.plane === "XY") snapGeo.rotateX(-Math.PI / 2);
      else if (activeSketch.plane === "YZ") snapGeo.rotateY(-Math.PI / 2);

      const snapMat = new THREE.MeshBasicMaterial({
        color: activeSnapType !== "none" ? 0xf59e0b : 0x3b82f6,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const snapMesh = new THREE.Mesh(snapGeo, snapMat);
      snapMesh.position.copy(cadPointToWorld(hoveredPoint, 0.16));
      dynamicGroup.add(snapMesh);

      // Draw active guide lines in 3D
      activeGuides.forEach(g => {
        if (g.type === "axis") {
          let pStart: Point2D = { x: 0, y: 0 };
          let pEnd: Point2D = { x: 0, y: 0 };
          if (g.axis === "x") {
            pStart = { x: g.value, y: -2000 };
            pEnd = { x: g.value, y: 2000 };
          } else {
            pStart = { x: -2000, y: g.value };
            pEnd = { x: 2000, y: g.value };
          }
          const gGeo = new THREE.BufferGeometry().setFromPoints([
            cadPointToWorld(pStart, 0.05),
            cadPointToWorld(pEnd, 0.05)
          ]);
          const gMat = new THREE.LineDashedMaterial({ color: 0xf59e0b, dashSize: 4, gapSize: 2 });
          const gLine = new THREE.Line(gGeo, gMat);
          gLine.computeLineDistances();
          dynamicGroup.add(gLine);
        }
      });
    }
  }, [
    showSolid,
    activeSketch,
    drawingPoints,
    tempEndPoint,
    tool,
    hoveredPoint,
    activeSnapType,
    activeGuides
  ]);

  // When toggling between solid and sketch mode, adjust mouse buttons and camera.up
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    if (showSolid) {
      // Restore upright world orientation — prevents inverted/flipped orbit after sketch alignment
      camera.up.set(0, 1, 0);
      controls.maxPolarAngle = Math.PI;
      controls.minPolarAngle = 0;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      controls.update();
    } else {
      // In sketch mode: Left Click is reserved for drawing/selecting, Right Click / Alt+Left orbits
      controls.mouseButtons = {
        LEFT: -1 as any,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      };
      controls.update();
    }
  }, [showSolid]);

  const alignCameraToSketchPlane = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const meshGroup = meshGroupRef.current;
    if (!camera || !controls || !meshGroup || !activeSketch) return;

    const plane = activeSketch.plane;
    const offset = activeSketch.offset || 0;

    const validMeshes: THREE.Mesh[] = [];
    meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (
          child.name === "helper-face-plane" ||
          child.name === "active-sketch-plane-helper" ||
          child.name.startsWith("sketch-profile-flat-") ||
          child.name === "operation-preview"
        ) {
          return;
        }
        validMeshes.push(child);
      }
    });

    let sumCoord = 0;
    let count = 0;

    validMeshes.forEach((mesh) => {
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }
      const box = mesh.geometry.boundingBox;
      if (box) {
        const worldBox = box.clone().applyMatrix4(mesh.matrixWorld);
        const center = new THREE.Vector3();
        worldBox.getCenter(center);
        if (plane === "XY") {
          sumCoord += center.y;
        } else if (plane === "XZ") {
          sumCoord += center.z;
        } else if (plane === "YZ") {
          sumCoord += center.x;
        }
        count++;
      }
    });
    const averageCoord = count > 0 ? sumCoord / count : 0;
    
    // Determine the direction from which to view the sketch plane:
    // If we have an explicit outward faceNormal from the selected face, place the camera in front of that face
    // (i.e. looking back towards the face and solid, keeping the solid behind the sketch plane).
    // Otherwise, place camera on the opposite side of the solid's center of mass.
    let sideSign = 1;
    if (activeSketch.faceNormal) {
      const [nx, ny, nz] = activeSketch.faceNormal;
      if (plane === "XY") {
        sideSign = ny >= 0 ? 1 : -1;
      } else if (plane === "XZ") {
        sideSign = nz >= 0 ? 1 : -1;
      } else if (plane === "YZ") {
        sideSign = nx >= 0 ? 1 : -1;
      }
    } else if (count > 0) {
      sideSign = averageCoord >= offset ? -1 : 1;
    }

    const distance = 160;

    // Use specific click point (origin) if sketch was created on a face, otherwise (0, 0, 0)
    const orig = activeSketch.origin || [0, 0, 0];
    const target = new THREE.Vector3(orig[0], orig[1], orig[2]);
    const camPos = new THREE.Vector3(orig[0], orig[1], orig[2]);

    // True Magnitude Camera Alignment:
    // Centers the target at the exact clicked region on the face and looks perpendicular to the plane,
    // ensuring the solid body is placed BEHIND the sketch plane
    if (plane === "XY") {
      // XY Plane (Horizontal / Top View)
      target.y = offset;
      camPos.y = offset + sideSign * distance;
      camPos.z += 0.001;
      camera.up.set(0, 0, -1); // Oriented so +Y in CAD is UP on screen
    } else if (plane === "XZ") {
      // XZ Plane (Front View)
      target.z = offset;
      camPos.z = offset + sideSign * distance;
      camera.up.set(0, 1, 0); // +Y is UP
    } else if (plane === "YZ") {
      // YZ Plane (Side / Profile View)
      target.x = offset;
      camPos.x = offset + sideSign * distance;
      camera.up.set(0, 1, 0); // +Y is UP
    }

    camera.position.copy(camPos);
    controls.target.copy(target);
    controls.update();
  };

  useEffect(() => {
    if (!showSolid && activeSketch) {
      const timer = setTimeout(() => {
        alignCameraToSketchPlane();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showSolid, activeSketch.id, activeSketch.plane, activeSketch.offset]);

  // Return view state to camera — also restores camera.up for correct orbit
  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(120, 100, 150);
      cameraRef.current.up.set(0, 1, 0); // CRITICAL: restore world Y-up before update
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const handleZoomToFit = () => {
    const meshGroup = meshGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!meshGroup || !camera || !controls) return;

    const box = new THREE.Box3();
    let hasGeom = false;

    meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (
          child.name === "helper-face-plane" ||
          child.name === "active-sketch-plane-helper" ||
          child.name.startsWith("sketch-profile-flat-") ||
          child.name === "operation-preview"
        )
          return;
        child.geometry.computeBoundingBox();
        const childBox = child.geometry.boundingBox;
        if (childBox) {
          const tempBox = childBox.clone().applyMatrix4(child.matrixWorld);
          box.union(tempBox);
          hasGeom = true;
        }
      }
    });

    if (!hasGeom) {
      handleResetCamera();
      return;
    }

    const center = new THREE.Vector3();
    box.getCenter(center);

    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    
    // Add comfortable padding
    cameraZ *= 1.4;

    // Reposition camera on a diagonal offset from center
    const dir = new THREE.Vector3(1, 0.8, 1.2).normalize();
    camera.position.copy(center).addScaledVector(dir, cameraZ);
    
    controls.target.copy(center);
    controls.update();
  };

  // Auto-fit camera and auto-select newly imported bodies so the transformation/placement HUD pops up immediately
  const prevImportedIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentIds = importedBodies.map(b => b.id);
    const newIds = currentIds.filter(id => !prevImportedIdsRef.current.includes(id));
    if (newIds.length > 0) {
      setSelectedImportedBodyIds(newIds);
      requestAnimationFrame(() => {
        handleZoomToFit();
      });
    }
    prevImportedIdsRef.current = currentIds;
  }, [importedBodies]);

  return (
    <div className="flex flex-col h-full bg-panel border border-border-main rounded overflow-hidden shadow-2xl relative">
      {/* CAD Bar Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-panel border-b border-border-main z-10">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded border border-blue-500/20 text-blue-400">
            <Box size={18} />
          </div>
          <div>
            <h3 className="font-sans font-bold text-xs text-text-main uppercase tracking-[1px]">Vista Interactiva 3D</h3>
            <p className="text-[10px] text-text-muted font-mono leading-none mt-0.5">Render WebGL acelerado B-Rep</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
            {/* Drawing Tools Dropdown Menu (Always Available) */}
            <div className="relative">
              <button
                onClick={() => setIsDrawMenuOpen(!isDrawMenuOpen)}
                className={`p-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                  !showSolid || tool !== "select"
                    ? "bg-blue-600/20 text-blue-400 border-blue-500/50 shadow-sm"
                    : "bg-surface text-text-muted border-border-subtle hover:bg-highlight-subtle hover:text-text-main"
                }`}
                title="Menú Desplegable de Herramientas de Dibujo y Boceto"
              >
                {tool === "line" && <PenTool size={13} />}
                {tool === "rectangle" && <Square size={13} />}
                {tool === "circle" && <Circle size={13} />}
                {tool === "triangle" && <Triangle size={13} />}
                {tool === "trim" && <Scissors size={13} />}
                {tool === "erase" && <Trash2 size={13} className="text-red-400" />}
                {tool === "select" && <MousePointer2 size={13} />}
                <span className="capitalize">
                  {tool === "line" ? "Línea" : tool === "rectangle" ? "Rectángulo" : tool === "circle" ? "Círculo" : tool === "triangle" ? "Triángulo" : tool === "trim" ? "Recortar" : tool === "erase" ? "Borrador" : "Herramientas de Dibujo"}
                </span>
                <ChevronDown size={12} className={`transition-transform duration-200 ${isDrawMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu Items */}
              {isDrawMenuOpen && (
                <div 
                  className="absolute left-0 top-full mt-1.5 w-52 bg-panel/95 backdrop-blur-md border border-border-main rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.5)] p-1.5 z-50 flex flex-col gap-1 pointer-events-auto animate-fadeIn"
                  onMouseLeave={() => setIsDrawMenuOpen(false)}
                >
                  <div className="text-[10px] font-bold text-text-muted uppercase px-2 py-1 tracking-wider border-b border-border-subtle/50">
                    Herramientas de Boceto 2D
                  </div>
                  <button
                    onClick={() => { setTool("select"); setDrawingPoints([]); setTempEndPoint(null); setIsSelectingMirrorAxis(false); setPendingMirrorPoints([]); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                      tool === "select" ? "bg-blue-600 text-white" : "text-text-muted hover:text-text-main hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MousePointer2 size={14} />
                      <span>Seleccionar</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">S</span>
                  </button>

                  <button
                    onClick={() => { setTool("line"); setDrawingPoints([]); setTempEndPoint(null); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                      tool === "line" ? "bg-blue-600 text-white" : "text-text-muted hover:text-text-main hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <PenTool size={14} />
                      <span>Línea</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">L</span>
                  </button>

                  <button
                    onClick={() => { setTool("rectangle"); setDrawingPoints([]); setTempEndPoint(null); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                      tool === "rectangle" ? "bg-blue-600 text-white" : "text-text-muted hover:text-text-main hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Square size={14} />
                      <span>Rectángulo</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">R</span>
                  </button>

                  <button
                    onClick={() => { setTool("circle"); setDrawingPoints([]); setTempEndPoint(null); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                      tool === "circle" ? "bg-blue-600 text-white" : "text-text-muted hover:text-text-main hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Circle size={14} />
                      <span>Círculo</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">C</span>
                  </button>

                  <button
                    onClick={() => { setTool("triangle"); setDrawingPoints([]); setTempEndPoint(null); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                      tool === "triangle" ? "bg-blue-600 text-white" : "text-text-muted hover:text-text-main hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Triangle size={14} />
                      <span>Triángulo</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">T</span>
                  </button>

                  <button
                    onClick={() => { setTool("trim"); setDrawingPoints([]); setTempEndPoint(null); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                      tool === "trim" ? "bg-amber-500 text-black font-bold" : "text-text-muted hover:text-amber-400 hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Scissors size={14} />
                      <span>Recortar Segmentos</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">X</span>
                  </button>

                  <button
                    onClick={() => { setTool("erase"); setDrawingPoints([]); setTempEndPoint(null); setIsDrawMenuOpen(false); }}
                    className={`w-full p-1.5 px-2 rounded flex items-center justify-between text-xs font-semibold transition-all cursor-pointer border-t border-border-subtle/50 mt-1 pt-1.5 ${
                      tool === "erase" ? "bg-red-600 text-white" : "text-red-400 hover:text-white hover:bg-red-600/80"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 size={14} />
                      <span>Borrar Figuras (Clic)</span>
                    </div>
                    <span className="text-[10px] opacity-60 font-mono">Del</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quick Delete Button for Selected 2D Sketch Profiles */}
            {!showSolid && selectedProfileIds.length > 0 && (
              <button
                onClick={() => {
                  if (activeSketch && onUpdateActiveSketch) {
                    onUpdateActiveSketch({
                      ...activeSketch,
                      profiles: activeSketch.profiles.filter(p => !selectedProfileIds.includes(p.id))
                    });
                    setSelectedProfileIds([]);
                  }
                }}
                className="p-1.5 px-2.5 rounded flex items-center gap-1.5 text-xs font-bold bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/50 shadow-sm transition-all cursor-pointer animate-fade-in"
                title="Eliminar las figuras seleccionadas del boceto (Supr / Backspace)"
              >
                <Trash2 size={13} />
                <span>Borrar ({selectedProfileIds.length})</span>
              </button>
            )}

            {/* Button to Create Sketch Plane on Face explicitly */}
            <button
              onClick={() => {
                const nextMode = !isFacePickMode;
                setIsFacePickMode(nextMode);
                if (!nextMode && onFaceSelectedRef.current) {
                  onFaceSelectedRef.current(null);
                }
              }}
              className={`p-1.5 px-2.5 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                isFacePickMode
                  ? "bg-emerald-600 text-white border-emerald-500 shadow-md animate-pulse"
                  : "bg-surface text-text-muted border-border-subtle hover:text-emerald-400 hover:bg-emerald-500/10"
              }`}
              title={isFacePickMode ? "Haz clic sobre una cara de un sólido para crear el plano de boceto" : "Activar modo para crear nuevo plano de boceto sobre una cara"}
            >
              <Sparkles size={13} />
              <span>{isFacePickMode ? "Selecciona una Cara..." : "Crear Plano Boceto"}</span>
            </button>

            {/* Button to Align in True Magnitude (Perpendicular 2D View) */}
            <button
              onClick={alignCameraToSketchPlane}
              className="p-1.5 px-2.5 rounded flex items-center gap-1.5 text-xs font-semibold border border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all cursor-pointer"
              title="Alinear vista de cámara en Verdadera Magnitud perpendicular al plano de boceto"
            >
              <Compass size={13} />
              <span>Verdadera Magnitud</span>
            </button>

            {/* Solid Boolean Ops Tools */}
            {showSolid && (
              <div className="flex items-center gap-1.5 mr-2 pr-2 border-r border-border-main">
                <button
                  onClick={() => onChangeActiveSolidOp?.("join")}
                  className={`p-1.5 px-2 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                    activeSolidOp === "join" 
                      ? "bg-amber-500 text-black border-amber-500 shadow" 
                      : "bg-surface text-text-muted border-border-subtle hover:text-text-main hover:bg-highlight-subtle"
                  }`}
                  title="Unir Sólidos"
                >
                  <Workflow size={13} />
                  <span>Unir</span>
                </button>
                <button
                  onClick={() => onChangeActiveSolidOp?.("cut")}
                  className={`p-1.5 px-2 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                    activeSolidOp === "cut" 
                      ? "bg-amber-500 text-black border-amber-500 shadow" 
                      : "bg-surface text-text-muted border-border-subtle hover:text-text-main hover:bg-highlight-subtle"
                  }`}
                  title="Restar Sólidos"
                >
                  <Box size={13} />
                  <span>Restar</span>
                </button>
                <button
                  onClick={() => onChangeActiveSolidOp?.("intersect")}
                  className={`p-1.5 px-2 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                    activeSolidOp === "intersect" 
                      ? "bg-amber-500 text-black border-amber-500 shadow" 
                      : "bg-surface text-text-muted border-border-subtle hover:text-text-main hover:bg-highlight-subtle"
                  }`}
                  title="Intersectar Sólidos"
                >
                  <Share2 size={13} />
                  <span>Intersectar</span>
                </button>
              </div>
            )}

            {/* Wireframe view switcher */}
            <button
            onClick={() => setShowEdgesOnly(!showEdgesOnly)}
            className={`p-1.5 px-3.5 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
              showEdgesOnly 
                ? "bg-blue-600/20 text-blue-400 border-blue-500/50" 
                : "bg-surface text-text-muted border-border-subtle hover:bg-highlight-subtle hover:text-text-main"
            }`}
            title="Toggle Wireframe overlay"
          >
            <Eye size={13} />
            <span>{showEdgesOnly ? "Solo Estructura" : "Sólido Completo"}</span>
          </button>

          <button
            onClick={handleZoomToFit}
            className="p-1.5 bg-surface rounded border border-border-subtle hover:bg-highlight-subtle text-text-muted hover:text-text-main transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold px-2.5"
            title="Ajustar cámara a la pieza (Zoom to Fit)"
          >
            <Expand size={13} />
            <span>Ajustar Vista</span>
          </button>

          <button
            onClick={() => setViewportTheme(viewportTheme === "light" ? "dark" : "light")}
            className={`p-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
              viewportTheme === "light" 
                ? "bg-amber-500/20 text-amber-500 border-amber-500/40" 
                : "bg-surface text-text-muted border-border-subtle hover:bg-highlight-subtle hover:text-text-main"
            }`}
            title="Cambiar tema de la vista 3D (Fondo Claro CAD / Oscuro)"
          >
            <Sun size={13} />
            <span>{viewportTheme === "light" ? "Vista CAD (Clara)" : "Vista CAD (Oscura)"}</span>
          </button>

          <button
            onClick={handleResetCamera}
            className="p-1.5 bg-surface rounded border border-border-subtle hover:bg-highlight-subtle text-text-muted hover:text-text-main transition-all cursor-pointer"
            title="Reset Camera Orientation"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Render canvas mount */}
      <div ref={mountRef} className="flex-1 w-full relative overflow-hidden transition-all duration-300 select-none" style={{ backgroundColor: viewportTheme === "light" ? "#f1f5f9" : "#0d0e11", backgroundImage: viewportTheme === "light" ? "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)" : "radial-gradient(circle at 1.5px 1.5px, rgba(255, 255, 255, 0.05) 1px, transparent 0)", backgroundSize: viewportTheme === "light" ? "100% 100%" : "32px 32px" }}>
        {/* Selection Box Visual Rectangle */}
        {selectionBox && (() => {
          const mountRect = mountRef.current?.getBoundingClientRect();
          if (!mountRect) return null;
          const left = Math.min(selectionBox.startX, selectionBox.currentX) - mountRect.left;
          const top = Math.min(selectionBox.startY, selectionBox.currentY) - mountRect.top;
          const width = Math.abs(selectionBox.currentX - selectionBox.startX);
          const height = Math.abs(selectionBox.currentY - selectionBox.startY);

          return (
            <div
              className="absolute pointer-events-none border border-blue-400 bg-blue-500/20 rounded z-30"
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`
              }}
            />
          );
        })()}
        {/* Live Drawing Measurement Badge Overlay */}
        {!showSolid && drawingPoints.length > 0 && tempEndPoint && (() => {
          const mountRect = mountRef.current?.getBoundingClientRect();
          if (!mountRect || !cameraRef.current) return null;

          const pStart = drawingPoints[drawingPoints.length - 1];
          const pEnd = tempEndPoint;

          const dx = pEnd.x - pStart.x;
          const dy = pEnd.y - pStart.y;
          const length = Math.hypot(dx, dy);

          // Calculate angle relative to horizontal X axis (in degrees: 0° to 360° or -180° to 180°)
          let rad = Math.atan2(dy, dx);
          let deg = (rad * 180) / Math.PI;
          if (deg < 0) deg += 360;

          // Compute midpoint in 3D world space
          const midCAD: Point2D = { x: (pStart.x + pEnd.x) / 2, y: (pStart.y + pEnd.y) / 2 };
          const plane = activeSketch?.plane || "XY";
          const offset = activeSketch?.offset || 0;
          const orig = activeSketch?.origin || [0, 0, 0];

          const worldPos = new THREE.Vector3();
          if (plane === "XY") {
            worldPos.set(orig[0] + midCAD.x, offset + 0.5, orig[2] - midCAD.y);
          } else if (plane === "XZ") {
            worldPos.set(orig[0] + midCAD.x, orig[1] + midCAD.y, offset + 0.5);
          } else if (plane === "YZ") {
            worldPos.set(offset + 0.5, orig[1] + midCAD.y, orig[2] + midCAD.x);
          }

          // Project 3D position to 2D screen coordinates
          const proj = worldPos.clone().project(cameraRef.current);
          const screenX = ((proj.x + 1) / 2) * mountRect.width;
          const screenY = ((-proj.y + 1) / 2) * mountRect.height;

          // Don't render if behind camera
          if (proj.z > 1) return null;

          return (
            <div
              className="absolute pointer-events-none z-30 transform -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-black/85 text-white backdrop-blur-md px-2.5 py-1 rounded-md border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.4)] text-[11px] font-mono tracking-tight animate-fade-in"
              style={{
                left: `${screenX}px`,
                top: `${screenY - 22}px`
              }}
            >
              <div className="flex items-center gap-1 text-cyan-300 font-bold">
                <span className="text-[9px] uppercase tracking-wider text-cyan-400/70 font-sans">L:</span>
                <span>{length.toFixed(2)} mm</span>
              </div>
              <div className="w-[1px] h-3 bg-white/20" />
              <div className="flex items-center gap-1 text-amber-300 font-bold">
                <span className="text-[9px] uppercase tracking-wider text-amber-400/70 font-sans">∠:</span>
                <span>{deg.toFixed(1)}°</span>
              </div>
              {tool === "rectangle" && (
                <>
                  <div className="w-[1px] h-3 bg-white/20" />
                  <div className="text-emerald-300 text-[10px]">
                    {Math.abs(dx).toFixed(1)} × {Math.abs(dy).toFixed(1)} mm
                  </div>
                </>
              )}
              {tool === "circle" && (
                <>
                  <div className="w-[1px] h-3 bg-white/20" />
                  <div className="text-emerald-300 text-[10px]">
                    R: {length.toFixed(2)} mm (Ø {(length * 2).toFixed(2)})
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* Floating 2D Sketch Properties Panel Overlay in 3D Mode */}
      {!showSolid && tool === "select" && selectedProfileIds.length >= 1 && !isSelectingMirrorAxis && (
        <SketchPropertiesPanel 
          activeSketch={activeSketch}
          selectedProfileIdsList={selectedProfileIds}
          setSelectedProfileIds={setSelectedProfileIds}
          onUpdateActiveSketch={onUpdateActiveSketch}
          onClose={() => setSelectedProfileIds([])}
          onStartCustomMirror={(isCopy: boolean) => {
            setCustomMirrorCopyState(isCopy);
            setIsSelectingMirrorAxis(true);
            setPendingMirrorPoints([]);
          }}
        />
      )}

      {/* Sketch Drawing Help HUD */}
      {!showSolid && (
        <div className="absolute top-16 left-4 z-20 pointer-events-none bg-panel/90 backdrop-blur border border-border-subtle p-2 rounded text-xs flex flex-col gap-1 shadow-md">
          <div className="flex items-center gap-1.5 text-blue-400 font-semibold">
            <Sparkles size={12} />
            <span>Modo Boceto 3D ({activeSketch?.plane} {activeSketch?.offset ? `+${activeSketch.offset}mm` : ''})</span>
          </div>
          <div className="text-[11px] text-text-muted">
            • <b>Clic Izquierdo:</b> Dibujar / Seleccionar<br />
            • <b>Botón Secundario (o Alt+Clic):</b> Orbitar 3D fluida<br />
            • <b>Botón Central (Rueda):</b> Zoom / Encuadre Panorámico<br />
            • <b>Esc:</b> Cancelar trazo actual
          </div>
          {hoveredPoint && (
            <div className="flex flex-col gap-0.5 border-t border-border-subtle pt-1 mt-0.5 font-mono text-[10px]">
              <div className="text-emerald-400 font-bold">
                X: {hoveredPoint.x.toFixed(1)} mm &nbsp; Y: {hoveredPoint.y.toFixed(1)} mm
              </div>
              {drawingPoints.length > 0 && tempEndPoint && (() => {
                const pStart = drawingPoints[drawingPoints.length - 1];
                const dx = tempEndPoint.x - pStart.x;
                const dy = tempEndPoint.y - pStart.y;
                const len = Math.hypot(dx, dy);
                let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
                if (deg < 0) deg += 360;
                return (
                  <div className="flex items-center gap-2 text-cyan-300 font-bold">
                    <span>L: {len.toFixed(2)} mm</span>
                    <span className="text-amber-300">∠ {deg.toFixed(1)}°</span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Floating Boolean Op Configurator */}
      {showSolid && activeSolidOp !== "none" && (
        <div className="absolute top-16 right-4 z-20 bg-[#121214]/90 backdrop-blur-md border border-amber-500/40 p-4 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.5)] w-72 pointer-events-auto flex flex-col gap-3 transition-all animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest leading-none flex items-center gap-1">
              <Sparkles size={11} className="text-amber-400" />
              <span>Operación Booleana</span>
            </span>
          </div>
          
          <div className="flex flex-col gap-2 mt-1">
            <div className="text-xs text-text-main">
              1. <span className={selectedTargetSolidId ? "text-green-400 font-bold" : "text-amber-400 font-bold"}>
                {selectedTargetSolidId ? "✓ Objetivo Seleccionado" : "Selecciona el Sólido Objetivo"}
              </span>
            </div>
            <div className="text-xs text-text-main">
              2. <span className={selectedToolSolidId ? "text-green-400 font-bold" : (!selectedTargetSolidId ? "text-text-muted" : "text-amber-400 font-bold")}>
                {selectedToolSolidId ? "✓ Herramienta Seleccionada" : "Selecciona el Sólido Herramienta"}
              </span>
            </div>
          </div>

          <div className="flex gap-2 mt-3 pt-3 border-t border-border-main">
            <button
              onClick={onCancelSolidOp}
              className="flex-1 py-1.5 bg-surface hover:bg-zinc-700 text-text-main font-semibold text-xs rounded transition-all cursor-pointer border border-border-subtle"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirmSolidOp}
              disabled={!selectedTargetSolidId || !selectedToolSolidId}
              className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/20 disabled:text-text-main/30 text-black font-bold text-xs rounded transition-all cursor-pointer shadow-lg"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* Floating Panel for Selected Imported STEP Body / Bodies (Move, Rotate, Scale, Delete) */}
      {(() => {
        if (selectedImportedBodyIds.length === 0) return null;
        const selectedBodies = importedBodies.filter(b => selectedImportedBodyIds.includes(b.id));
        if (selectedBodies.length === 0) return null;

        const isSingle = selectedBodies.length === 1;
        const primaryBody = selectedBodies[0];

        const pos = primaryBody.position || [0, 0, 0];
        const rot = primaryBody.rotation || [0, 0, 0];
        const scl = primaryBody.scale || [1, 1, 1];

        return (
          <div className="absolute top-16 right-4 z-30 bg-[#121214]/95 backdrop-blur-md border border-blue-500/50 p-4 rounded-xl shadow-[0_10px_35px_rgba(0,0,0,0.6)] w-80 pointer-events-auto flex flex-col gap-3 transition-all animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-subtle/60 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">
                  <Box size={14} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                    {isSingle ? "Pieza STEP Seleccionada" : `Selección Múltiple (${selectedBodies.length} Piezas)`}
                  </span>
                  <span className="text-xs font-semibold text-text-main truncate max-w-[170px]" title={isSingle ? primaryBody.name : `${selectedBodies.length} piezas seleccionadas`}>
                    {isSingle ? primaryBody.name : `${selectedBodies.length} piezas activas`}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedImportedBodyIds([])}
                className="text-text-muted hover:text-text-main p-1 hover:bg-white/10 rounded transition-colors cursor-pointer"
                title="Cerrar selección"
              >
                <X size={14} />
              </button>
            </div>

            {/* Transform Controls */}
            <div className="flex flex-col gap-2.5 text-xs">
              {/* Position (Mover) */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Posición (Mover en mm)</span>
                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <div key={axis} className="flex items-center bg-black/40 border border-border-subtle rounded px-1.5 py-1">
                      <span className={`text-[10px] font-bold mr-1 ${axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'}`}>
                        {axis}:
                      </span>
                      <input
                        type="number"
                        step="1"
                        value={pos[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const delta = val - pos[i];
                          selectedBodies.forEach(b => {
                            const bPos = b.position ? [...b.position] : [0, 0, 0];
                            bPos[i] = isSingle ? val : bPos[i] + delta;
                            onUpdateImportedBody?.({ ...b, position: bPos as [number, number, number] });
                          });
                        }}
                        className="w-full bg-transparent text-text-main outline-none text-right text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rotation (Girar) */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Rotación (Girar en Grados °)</span>
                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <div key={axis} className="flex items-center bg-black/40 border border-border-subtle rounded px-1.5 py-1">
                      <span className={`text-[10px] font-bold mr-1 ${axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'}`}>
                        {axis}°:
                      </span>
                      <input
                        type="number"
                        step="15"
                        value={rot[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const delta = val - rot[i];
                          selectedBodies.forEach(b => {
                            const bRot = b.rotation ? [...b.rotation] : [0, 0, 0];
                            bRot[i] = isSingle ? val : bRot[i] + delta;
                            onUpdateImportedBody?.({ ...b, rotation: bRot as [number, number, number] });
                          });
                        }}
                        className="w-full bg-transparent text-text-main outline-none text-right text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Scale (Escalar) */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Escala (Multiplicador)</span>
                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <div key={axis} className="flex items-center bg-black/40 border border-border-subtle rounded px-1.5 py-1">
                      <span className="text-[10px] font-bold mr-1 text-amber-400">
                        {axis}:
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.01"
                        value={scl[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 1;
                          selectedBodies.forEach(b => {
                            const bScl = b.scale ? [...b.scale] : [1, 1, 1];
                            bScl[i] = Math.max(0.01, val);
                            onUpdateImportedBody?.({ ...b, scale: bScl as [number, number, number] });
                          });
                        }}
                        className="w-full bg-transparent text-text-main outline-none text-right text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Actions (Delete, Reset) */}
            <div className="flex gap-2 pt-2 border-t border-border-subtle/60 mt-1">
              <button
                onClick={() => {
                  selectedBodies.forEach(b => {
                    onUpdateImportedBody?.({
                      ...b,
                      position: [0, 0, 0],
                      rotation: [0, 0, 0],
                      scale: [1, 1, 1]
                    });
                  });
                }}
                className="flex-1 py-1.5 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-xs font-semibold rounded transition-all cursor-pointer border border-border-subtle flex items-center justify-center gap-1"
                title="Resetear posición y rotación de las piezas seleccionadas"
              >
                <RefreshCw size={11} />
                <span>Restablecer</span>
              </button>
              <button
                onClick={() => {
                  if (onDeleteImportedBody) {
                    selectedBodies.forEach(b => onDeleteImportedBody(b.id));
                    setSelectedImportedBodyIds([]);
                  }
                }}
                className="flex-1 py-1.5 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white border border-red-500/40 text-xs font-semibold rounded transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                title="Eliminar las piezas seleccionadas del modelo STEP"
              >
                <Trash2 size={12} />
                <span>{isSingle ? "Borrar Pieza" : `Borrar (${selectedBodies.length})`}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Camera View Gizmo & Materials Palette Overlay */}
      <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-3">
        {/* Preset selector */}
        <div className="bg-panel/95 backdrop-blur border border-border-main p-2.5 rounded shadow-xl flex flex-col gap-1.5 pointer-events-auto">
          <div className="flex items-center gap-1.5 text-[9px] font-bold text-text-main/40 uppercase tracking-[1.5px] px-1">
            <Sparkles size={11} className="text-blue-400" />
            <span>Paleta de Materiales</span>
          </div>
          <div className="flex items-center gap-1">
            {PRESET_MATERIALS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setActivePreset(preset.id);
                  // Trigger event using side effect or callbacks if needed
                  // For simplicity we map standard styling dynamically
                  material.color = preset.color;
                  material.roughness = preset.roughness;
                  material.metalness = preset.metalness;
                  material.opacity = preset.opacity;
                }}
                className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-115 active:scale-95 flex items-center justify-center cursor-pointer`}
                style={{ 
                  backgroundColor: preset.color,
                  borderColor: activePreset === preset.id ? "#2563eb" : "transparent"
                }}
                title={preset.name}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Floating 3D Operation Glassmorphic Card */}
      {!showSolid && activeSketch && activeSketch.profiles && activeSketch.profiles.length > 0 && (
        <div className="absolute top-16 right-4 z-20 bg-[#121214]/90 backdrop-blur-md border border-amber-500/40 p-4 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.5)] w-72 pointer-events-auto flex flex-col gap-3 transition-all animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest leading-none flex items-center gap-1">
              <Sparkles size={11} className="text-amber-400" />
              <span>Operación en Progreso</span>
            </span>
            <span className="text-[9px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded font-mono font-bold border border-amber-500/20">
              {selectedShapeIndices.length} {selectedShapeIndices.length === 1 ? "Región" : "Regiones"}
            </span>
          </div>

          <div className="h-[1px] bg-highlight-strong" />

          {selectedShapeIndices.length === 0 ? (
            <div className="flex flex-col gap-2.5 py-1">
              <p className="text-[11px] text-text-muted leading-normal">
                Haz clic en las regiones sombreadas de color azul en la vista 3D para seleccionarlas y configurar la operación.
              </p>
              {onSelectAllShapes && (
                <button
                  onClick={onSelectAllShapes}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-text-main font-bold text-xs rounded transition-all duration-150 active:scale-95 shadow-[0_2px_8px_rgba(37,99,235,0.3)] cursor-pointer text-center"
                >
                  Seleccionar Todo
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Toggle Operation Type */}
              <div className="flex rounded bg-black/30 p-1 border border-border-subtle">
                <button
                  onClick={() => onChangePendingOpType?.("extrude")}
                  className={`flex-1 py-1 rounded text-[11px] font-semibold text-center transition-all ${
                    pendingOpType === "extrude"
                      ? "bg-amber-500 text-black shadow font-bold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Extruir
                </button>
                <button
                  onClick={() => onChangePendingOpType?.("revolve")}
                  className={`flex-1 py-1 rounded text-[11px] font-semibold text-center transition-all ${
                    pendingOpType === "revolve"
                      ? "bg-amber-500 text-black shadow font-bold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Revolución
                </button>
              </div>

              {/* Parameters Sliders */}
              {pendingOpType === "extrude" ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-text-muted">Altura:</span>
                    <span className="text-amber-400 font-mono font-bold">{pendingHeight} mm</span>
                  </div>
                  <input
                    type="range"
                    min="-60"
                    max="100"
                    step="2"
                    value={pendingHeight}
                    onChange={(e) => onChangePendingHeight?.(parseInt(e.target.value))}
                    className="w-full h-1 bg-highlight-strong accent-amber-500 rounded-lg appearance-none cursor-pointer"
                  />

                  {/* Corner styling inside floating card */}
                  <div className="mt-2.5 pt-2.5 border-t border-border-subtle flex flex-col gap-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-text-muted">Estilo de Esquina (3D):</span>
                    </div>
                    <div className="flex rounded bg-black/35 p-0.5 border border-border-subtle">
                      {(["none", "fillet", "chamfer"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => onChangePendingBevelType?.(type)}
                          className={`flex-1 py-1 rounded text-[10px] font-semibold text-center transition-all cursor-pointer ${
                            pendingBevelType === type
                              ? "bg-amber-500 text-black shadow font-bold"
                              : "text-text-muted hover:text-text-main"
                          }`}
                        >
                          {type === "none" ? "Ninguno" : type === "fillet" ? "Redondeado" : "Chaflán"}
                        </button>
                      ))}
                    </div>

                    {pendingBevelType !== "none" && (
                      <div className="flex flex-col gap-1.5 mt-1 animate-fadeIn">
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-text-muted">{pendingBevelType === "fillet" ? "Radio de Redondeo:" : "Distancia de Chaflán:"}</span>
                          <span className="text-amber-400 font-mono font-bold">{pendingBevelSize.toFixed(1)} mm</span>
                        </div>
                        <input
                          type="range"
                          min="0.2"
                          max="10"
                          step="0.2"
                          value={pendingBevelSize}
                          onChange={(e) => onChangePendingBevelSize?.(parseFloat(e.target.value))}
                          className="w-full h-1 bg-highlight-strong accent-amber-500 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    )}

                    {/* Conicidad / Inclinación (Taper Scale) */}
                    <div className="mt-2.5 pt-2.5 border-t border-border-subtle flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-text-muted">Conicidad (Inclinación):</span>
                        <span className="text-amber-400 font-mono font-bold">
                          {pendingTaperScale === 1.0 
                            ? "Recto (100%)" 
                            : pendingTaperScale === 0.0 
                              ? "Punta (Tetraedro/Pirámide)" 
                              : `${(pendingTaperScale * 100).toFixed(0)}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={pendingTaperScale}
                        onChange={(e) => onChangePendingTaperScale?.(parseFloat(e.target.value))}
                        className="w-full h-1 bg-highlight-strong accent-amber-500 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-text-muted">Ángulo:</span>
                    <span className="text-amber-400 font-mono font-bold">{pendingAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="360"
                    step="10"
                    value={pendingAngle}
                    onChange={(e) => onChangePendingAngle?.(parseInt(e.target.value))}
                    className="w-full h-1 bg-highlight-strong accent-amber-500 rounded-lg appearance-none cursor-pointer"
                  />

                  {/* Axis Selector info in card */}
                  <div className="flex flex-col gap-1 text-[10px] text-text-muted bg-black/40 p-1.5 rounded mt-1 border border-border-subtle">
                    <div className="flex justify-between">
                      <span>Eje de revolución:</span>
                      <span className="font-semibold text-amber-400 font-mono">
                        {pendingRevolveAxisPoint1 && pendingRevolveAxisPoint2 ? "Personalizado" : "Eje Y"}
                      </span>
                    </div>
                    {pendingRevolveAxisPoint1 && pendingRevolveAxisPoint2 && (
                      <div className="font-mono text-[9px] opacity-80 mt-0.5">
                        ({pendingRevolveAxisPoint1.x}, {pendingRevolveAxisPoint1.y}) → ({pendingRevolveAxisPoint2.x}, {pendingRevolveAxisPoint2.y})
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  onClick={onConfirmOperation}
                  className="py-1.5 bg-emerald-600 hover:bg-emerald-500 text-text-main font-bold text-xs rounded transition-all duration-150 active:scale-95 shadow-[0_2px_8px_rgba(16,185,129,0.3)] cursor-pointer text-center"
                >
                  ✓ Confirmar
                </button>
                <button
                  onClick={onCancelOperation}
                  className="py-1.5 bg-surface hover:bg-zinc-700 text-text-main font-bold text-xs rounded border border-border-subtle transition-all duration-150 active:scale-95 cursor-pointer text-center"
                >
                  Cancelar
                </button>
              </div>

              {onSelectAllShapes && (
                <button
                  onClick={onSelectAllShapes}
                  className="w-full py-1 text-center text-[10px] text-amber-500 hover:text-amber-400 font-semibold transition-all border border-amber-500/20 hover:border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 rounded mt-0.5 cursor-pointer"
                >
                  Seleccionar Todo
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

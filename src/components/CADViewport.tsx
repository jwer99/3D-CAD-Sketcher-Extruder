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
  Trash2,
  Hexagon,
  Check,
  Layers,
  CircleDashed,
  Split,
  Edit3
} from "lucide-react";
import { SketchData, CADOperation, MaterialStyle, PRESET_MATERIALS, PlaneType, Point2D, ImportedBody, ProfileType, Profile } from "../types";
import * as polygonClipping from "polygon-clipping";
import { getSolidRegions, isPointInPolygon } from "../GeometryUtils";
import { CSG } from "three-csg-ts";
import SketchPropertiesPanel from "./SketchPropertiesPanel";
import { bodyGeometryCache } from "../App";

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
  onDeleteImportedBodies?: (ids: string[]) => void;
  onUpdateImportedBody?: (body: ImportedBody) => void;
  onUpdateImportedBodies?: (bodies: ImportedBody[]) => void;
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

  // Explicit professional Sketch Mode controls
  isSketchMode?: boolean;
  onEnterSketchMode?: (sketchId?: string) => void;
  onExitSketchMode?: () => void;
  onShowToast?: (message: string, type?: "success" | "info" | "error") => void;
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
  onDeleteImportedBodies,
  onUpdateImportedBody,
  onUpdateImportedBodies,
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
  previousIntersectionSegments,
  isSketchMode,
  onEnterSketchMode,
  onExitSketchMode,
  onShowToast
}: CADViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const importedMeshGroupRef = useRef<THREE.Group | null>(null);
  const dynamicOverlayGroupRef = useRef<THREE.Group | null>(null);

  const onShowToastRef = useRef(onShowToast);
  onShowToastRef.current = onShowToast;
  const onFaceSelectedRef = useRef(onFaceSelected);
  onFaceSelectedRef.current = onFaceSelected;
  const onMeshCreatedRef = useRef(onMeshCreated);
  onMeshCreatedRef.current = onMeshCreated;
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

  // First-class explicit Sketch Mode state
  const [internalSketchMode, setInternalSketchMode] = useState<boolean>(isSketchMode ?? false);
  // Sync sketch mode state from prop
  useEffect(() => {
    if (isSketchMode !== undefined) {
      setInternalSketchMode(isSketchMode);
      isActuallySketchModeRef.current = isSketchMode;
      if (!isSketchMode) {
        setTool("select");
        toolRef.current = "select";
        setDrawingPoints([]);
        setTempEndPoint(null);
      }
    }
  }, [isSketchMode]);

  const isActuallySketchMode = isSketchMode !== undefined ? isSketchMode : internalSketchMode;
  const isActuallySketchModeRef = useRef(isActuallySketchMode);
  isActuallySketchModeRef.current = isActuallySketchMode;

  const handleFinishSketch = () => {
    setShowExtrudeCard(false);
    setDrawingPoints([]);
    setTempEndPoint(null);
    setTool("select");
    toolRef.current = "select";
    setInternalSketchMode(false);
    isActuallySketchModeRef.current = false;
    if (onExitSketchMode) {
      onExitSketchMode();
    }
  };

  const handleStartSketchMode = () => {
    setShowExtrudeCard(false);
    if (onEnterSketchMode) {
      onEnterSketchMode(activeSketch.id);
    } else {
      setInternalSketchMode(true);
    }
    setTimeout(() => {
      alignCameraToSketchPlane();
    }, 50);
  };

  // Sketch Drawing State on 3D Plane
  const [tool, setTool] = useState<
    ProfileType | "select" | "line" | "rectangle-center" | "arc" | "slot" | "trim" | "offset" | "erase"
  >("select");
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point2D[]>([]);
  const [tempEndPoint, setTempEndPoint] = useState<Point2D | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<Point2D | null>(null);
  const [activeSnapType, setActiveSnapType] = useState<SnapType>('none');
  const [activeGuides, setActiveGuides] = useState<Guideline[]>([]);
  const [isSelectingMirrorAxis, setIsSelectingMirrorAxis] = useState(false);
  const [customMirrorCopyState, setCustomMirrorCopyState] = useState(false);
  const [pendingMirrorPoints, setPendingMirrorPoints] = useState<Point2D[]>([]);
  const draggingVertexRef = useRef<{ profileId: string; vertexIndex: number } | null>(null);
  const [osnapSettings, setOsnapSettings] = useState({
    grid: true, vertex: true, midpoint: true, center: true, intersection: true, edge: true, angle: true, guides: true
  });
  const [gridSize, setGridSize] = useState<number>(5); // default 5mm grid
  const [isOsnapMenuOpen, setIsOsnapMenuOpen] = useState(false);
  const [isDrawMenuOpen, setIsDrawMenuOpen] = useState(false);
  const [showExtrudeCard, setShowExtrudeCard] = useState<boolean>(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState<boolean>(false);

  const handleDeleteSelectedProfiles = () => {
    if (activeSketchRef.current && onUpdateActiveSketchRef.current && selectedProfileIds.length > 0) {
      onUpdateActiveSketchRef.current({
        ...activeSketchRef.current,
        profiles: activeSketchRef.current.profiles.filter(p => !selectedProfileIds.includes(p.id))
      });
      setSelectedProfileIds([]);
    }
  };

  const handleClearSketch = () => {
    if (window.confirm("¿Seguro que deseas vaciar todas las figuras de este boceto?")) {
      if (activeSketchRef.current && onUpdateActiveSketchRef.current) {
        onUpdateActiveSketchRef.current({
          ...activeSketchRef.current,
          profiles: []
        });
        setSelectedProfileIds([]);
        setDrawingPoints([]);
        setTempEndPoint(null);
      }
    }
  };
  const [hoveredSegment, setHoveredSegment] = useState<{ profileId: string, index: number } | null>(null);
  const [hoveredProfileId, setHoveredProfileId] = useState<string | null>(null);

  // Selected Imported STEP Bodies for Multi-Selection (Click + Ctrl or Selection Box), Move/Rotate/Scale/Delete
  const [selectedImportedBodyIds, setSelectedImportedBodyIds] = useState<string[]>([]);
  const selectedImportedBodyIdsRef = useRef(selectedImportedBodyIds);
  selectedImportedBodyIdsRef.current = selectedImportedBodyIds;

  // Custom step inputs for moving and rotating selected STEP bodies
  const [customMoveStep, setCustomMoveStep] = useState<{ x: string; y: string; z: string }>({ x: "10", y: "10", z: "10" });
  const [customRotateStep, setCustomRotateStep] = useState<{ x: string; y: string; z: string }>({ x: "90", y: "90", z: "90" });

  // Box selection drag state on canvas
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const importedBodiesRef = useRef(importedBodies);
  importedBodiesRef.current = importedBodies;
  const onDeleteImportedBodyRef = useRef(onDeleteImportedBody);
  onDeleteImportedBodyRef.current = onDeleteImportedBody;
  const onDeleteImportedBodiesRef = useRef(onDeleteImportedBodies);
  onDeleteImportedBodiesRef.current = onDeleteImportedBodies;
  const onUpdateImportedBodyRef = useRef(onUpdateImportedBody);
  onUpdateImportedBodyRef.current = onUpdateImportedBody;
  const onUpdateImportedBodiesRef = useRef(onUpdateImportedBodies);
  onUpdateImportedBodiesRef.current = onUpdateImportedBodies;

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
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
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

      // Fast CAD Tool Hotkeys when in sketch mode
      if (isActuallySketchModeRef.current) {
        if (e.key === 'Escape') {
          setTool('select');
          toolRef.current = 'select';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'l' || e.key === 'L') {
          setTool('line');
          toolRef.current = 'line';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'r' || e.key === 'R') {
          const next = e.shiftKey ? 'rectangle-center' : 'rectangle';
          setTool(next);
          toolRef.current = next;
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'c' || e.key === 'C') {
          setTool('circle');
          toolRef.current = 'circle';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'a' || e.key === 'A') {
          setTool('arc');
          toolRef.current = 'arc';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'h' || e.key === 'H') {
          setTool('hexagon');
          toolRef.current = 'hexagon';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 't' || e.key === 'T') {
          setTool('triangle');
          toolRef.current = 'triangle';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 's' || e.key === 'S') {
          setTool('select');
          toolRef.current = 'select';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'x' || e.key === 'X') {
          setTool('trim');
          toolRef.current = 'trim';
          setDrawingPoints([]);
          setTempEndPoint(null);
        } else if (e.key === 'o' || e.key === 'O') {
          setTool('slot');
          toolRef.current = 'slot';
          setDrawingPoints([]);
          setTempEndPoint(null);
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
    // Left Click / Drag: 3D Orbit (rotación suave de la cámara) / Selección / Dibujo
    // Right Click / Drag: Desplazamiento / Pan (Encuadre)
    // Middle Click / Drag (Rueda pulsada): Desplazamiento / Pan
    // Wheel Scroll (Rueda girada): Zoom interactivo
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN
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

    // 7. Core Groups:
    // - meshGroup: holds lightweight procedural 2D sketches and boolean solid operations
    // - importedMeshGroup: dedicated high-performance group for massive STEP assemblies (350MB+)
    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const importedMeshGroup = new THREE.Group();
    scene.add(importedMeshGroup);
    importedMeshGroupRef.current = importedMeshGroup;

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
      if (!mountRef.current || !renderer || !camera) return;
      
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // 1. Fast path for imported STEP bodies (checks importedMeshGroup directly with bounding box optimization)
      // NOTE: Bypass body selection when in Face Pick Mode so clicks on imported STEP faces detect the face plane!
      if (!isFacePickModeRef.current && importedMeshGroupRef.current && importedMeshGroupRef.current.children.length > 0 && (!isActuallySketchModeRef.current || toolRef.current === "select")) {
        const importedIntersects = raycaster.intersectObjects(importedMeshGroupRef.current.children, false);
        if (importedIntersects.length > 0) {
          const firstHit = importedIntersects[0].object;
          if (firstHit.userData?.bodyId) {
            const bodyId = firstHit.userData.bodyId;
            const isCtrl = event.ctrlKey || event.metaKey || event.shiftKey;
            
            setSelectedImportedBodyIds(prev => {
              if (isCtrl) {
                return prev.includes(bodyId) ? prev.filter(id => id !== bodyId) : [...prev, bodyId];
              } else {
                return prev.includes(bodyId) && prev.length === 1 ? [] : [bodyId];
              }
            });
            return;
          }
        }
      }

      // Collect all candidate objects: both native CAD solid meshes and imported STEP bodies!
      const allCandidateObjects: THREE.Object3D[] = [];
      if (meshGroupRef.current) {
        allCandidateObjects.push(...meshGroupRef.current.children);
      }
      if (importedMeshGroupRef.current) {
        allCandidateObjects.push(...importedMeshGroupRef.current.children);
      }

      const intersects = raycaster.intersectObjects(allCandidateObjects, true);

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

        // Check if user clicked on a flat sketch profile area (ONLY in 3D Solid Mode for selecting extrusion regions)
        if (!isActuallySketchModeRef.current) {
          const flatIntersect = intersects.find(inst => inst.object.name.startsWith("sketch-profile-flat-"));
          if (flatIntersect) {
            const mesh = flatIntersect.object as THREE.Mesh;
            const idx = mesh.userData.index;
            if (onShapeClickRef.current) {
              onShapeClickRef.current(idx);
            }
            return;
          }
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

            // High precision offset to match exact model face position
            detectedOffset = Math.round(detectedOffset * 100) / 100;

            if (onFaceSelectedRef.current) {
              onFaceSelectedRef.current({
                plane: detectedPlane,
                offset: detectedOffset,
                faceNormal: [faceNormal.x, faceNormal.y, faceNormal.z],
                point: [point.x, point.y, point.z]
              });
              onShowToastRef.current?.(`Cara detectada en plano ${detectedPlane} (${detectedOffset}mm). Pulsa '✓ Crear Boceto' para comenzar a dibujar.`, "info");
            }
            // Automatically exit face pick mode once a face is chosen
            setIsFacePickMode(false);
          }
          return;
        }

        // Allow selecting and transforming imported STEP bodies when in "select" tool mode (or in 3D Solid Mode)
        if (!isActuallySketchModeRef.current || toolRef.current === "select") {
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
        if ((!isActuallySketchModeRef.current || toolRef.current === "select") && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
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

      const isSketchMode = isActuallySketchModeRef.current || !showSolid;
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

      // Double-click to complete open polyline in line tool
      if (e.detail === 2 && currentTool === "line" && curPts.length >= 2) {
        const newProfile: Profile = {
          id: Math.random().toString(36).substr(2, 9),
          type: "polygon",
          points: [...curPts],
          isClosed: false
        };
        updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
        setDrawingPoints([]);
        setTempEndPoint(null);
        return;
      }

      // Handle Eraser / Delete Tool (Clicking on any sketch profile deletes it immediately)
      if (currentTool === "erase") {
        const profileToDelete = curSketch.profiles.find(p => {
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

        if (profileToDelete) {
          updateSketch({
            ...curSketch,
            profiles: curSketch.profiles.filter(p => p.id !== profileToDelete.id)
          });
          setSelectedProfileIds(prev => prev.filter(id => id !== profileToDelete.id));
        }
        return;
      }

      // Handle Trim Tool (Clicking near a segment trims that piece)
      if (currentTool === "trim") {
        const clickedProfile = curSketch.profiles.find(p => {
          if (!p.points || p.points.length === 0) return false;
          if (p.center && Math.hypot(cadPoint.x - p.center.x, cadPoint.y - p.center.y) <= (p.radius || 10) + 3) return true;
          for (let i = 0; i < p.points.length; i++) {
            const p1 = p.points[i];
            const p2 = p.points[(i + 1) % p.points.length];
            const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) ** 2;
            if (l2 < 1e-4) continue;
            const t = Math.max(0, Math.min(1, ((cadPoint.x - p1.x) * (p2.x - p1.x) + (cadPoint.y - p1.y) * (p2.y - p1.y)) / l2));
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            if (Math.hypot(cadPoint.x - projX, cadPoint.y - projY) < 4.5) return true;
          }
          return false;
        });

        if (clickedProfile) {
          if (clickedProfile.points.length > 3) {
            let bestSegIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < clickedProfile.points.length; i++) {
              const p1 = clickedProfile.points[i];
              const p2 = clickedProfile.points[(i + 1) % clickedProfile.points.length];
              const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) ** 2;
              if (l2 < 1e-4) continue;
              const t = Math.max(0, Math.min(1, ((cadPoint.x - p1.x) * (p2.x - p1.x) + (cadPoint.y - p1.y) * (p2.y - p1.y)) / l2));
              const projX = p1.x + t * (p2.x - p1.x);
              const projY = p1.y + t * (p2.y - p1.y);
              const d = Math.hypot(cadPoint.x - projX, cadPoint.y - projY);
              if (d < bestDist) {
                bestDist = d;
                bestSegIdx = i;
              }
            }
            if (bestSegIdx !== -1 && bestDist < 5.5) {
              if (clickedProfile.isClosed) {
                const reordered: Point2D[] = [];
                for (let j = 0; j < clickedProfile.points.length; j++) {
                  const idx = (bestSegIdx + 1 + j) % clickedProfile.points.length;
                  reordered.push(clickedProfile.points[idx]);
                }
                const updatedProf: Profile = { ...clickedProfile, points: reordered, isClosed: false };
                updateSketch({
                  ...curSketch,
                  profiles: curSketch.profiles.map(p => p.id === clickedProfile.id ? updatedProf : p)
                });
                return;
              } else {
                const updatedPoints = clickedProfile.points.filter((_, idx) => idx !== bestSegIdx);
                const updatedProf: Profile = { ...clickedProfile, points: updatedPoints };
                updateSketch({
                  ...curSketch,
                  profiles: curSketch.profiles.map(p => p.id === clickedProfile.id ? updatedProf : p)
                });
                return;
              }
            }
          }
          // Default: delete clicked profile
          updateSketch({
            ...curSketch,
            profiles: curSketch.profiles.filter(p => p.id !== clickedProfile.id)
          });
          setSelectedProfileIds(prev => prev.filter(id => id !== clickedProfile.id));
        }
        return;
      }

      // Handle Select Tool for 2D profiles and vertex manipulation
      if (currentTool === "select") {
        // First check if clicking on an existing vertex for interactive dragging
        for (const p of curSketch.profiles) {
          for (let i = 0; i < p.points.length; i++) {
            if (Math.hypot(cadPoint.x - p.points[i].x, cadPoint.y - p.points[i].y) < 3.5) {
              draggingVertexRef.current = { profileId: p.id, vertexIndex: i };
              setSelectedProfileIds([p.id]);
              return;
            }
          }
        }

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
          setShowExtrudeCard(false);
          setSelectedProfileIds(prev => {
            if (isCtrl) {
              return prev.includes(clickedProfile.id) ? prev.filter(id => id !== clickedProfile.id) : [...prev, clickedProfile.id];
            } else {
              return prev.includes(clickedProfile.id) && prev.length === 1 ? [] : [clickedProfile.id];
            }
          });
        } else {
          // If no outline was clicked, check if clicking inside a solid watertight region/area!
          const regions = getSolidRegions(curSketch);
          let clickedRegionIdx = -1;
          for (let i = 0; i < regions.length; i++) {
            const reg = regions[i];
            const inOuter = isPointInPolygon(cadPoint, reg.outerProfile.points);
            const inHole = reg.holeProfiles.some(h => isPointInPolygon(cadPoint, h.points));
            if (inOuter && !inHole) {
              clickedRegionIdx = i;
              break;
            }
          }

          if (clickedRegionIdx !== -1) {
            // Clicked directly on a watertight closed region!
            onShapeClickRef.current?.(clickedRegionIdx);
            setSelectedProfileIds([]);
            setShowExtrudeCard(true);
            return;
          }

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
      } else if (currentTool === "rectangle-center") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else {
          const center = curPts[0];
          const dx = Math.abs(cadPoint.x - center.x);
          const dy = Math.abs(cadPoint.y - center.y);
          const points: Point2D[] = [
            { x: center.x - dx, y: center.y - dy },
            { x: center.x + dx, y: center.y - dy },
            { x: center.x + dx, y: center.y + dy },
            { x: center.x - dx, y: center.y + dy }
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
      } else if (currentTool === "arc") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else if (curPts.length === 1) {
          setDrawingPoints([curPts[0], cadPoint]);
        } else {
          const p1 = curPts[0];
          const p2 = curPts[1];
          const p3 = cadPoint;
          const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
          if (Math.abs(D) < 1e-4) {
            const newProfile: Profile = {
              id: Math.random().toString(36).substr(2, 9),
              type: "polygon",
              points: [p1, p2, p3],
              isClosed: false
            };
            updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          } else {
            const cx = ((p1.x*p1.x + p1.y*p1.y)*(p2.y - p3.y) + (p2.x*p2.x + p2.y*p2.y)*(p3.y - p1.y) + (p3.x*p3.x + p3.y*p3.y)*(p1.y - p2.y)) / D;
            const cy = ((p1.x*p1.x + p1.y*p1.y)*(p3.x - p2.x) + (p2.x*p2.x + p2.y*p2.y)*(p1.x - p3.x) + (p3.x*p3.x + p3.y*p3.y)*(p2.x - p1.x)) / D;
            const radius = Math.hypot(p1.x - cx, p1.y - cy);
            let a1 = Math.atan2(p1.y - cy, p1.x - cx);
            let a2 = Math.atan2(p2.y - cy, p2.x - cx);
            let a3 = Math.atan2(p3.y - cy, p3.x - cx);
            const norm = (a: number) => (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
            const na1 = norm(a1);
            const na2 = norm(a2);
            const na3 = norm(a3);
            const isBetweenCCW = (start: number, mid: number, end: number) => {
              const diffEnd = (end - start + 2 * Math.PI) % (2 * Math.PI);
              const diffMid = (mid - start + 2 * Math.PI) % (2 * Math.PI);
              return diffMid < diffEnd;
            };
            const ccw = isBetweenCCW(na1, na2, na3);
            const arcPts: Point2D[] = [];
            const steps = 24;
            let sweep = ccw 
              ? ((na3 - na1 + 2 * Math.PI) % (2 * Math.PI)) 
              : -((na1 - na3 + 2 * Math.PI) % (2 * Math.PI));
            for (let s = 0; s <= steps; s++) {
              const ang = a1 + (sweep * s) / steps;
              arcPts.push({
                x: parseFloat((cx + radius * Math.cos(ang)).toFixed(2)),
                y: parseFloat((cy + radius * Math.sin(ang)).toFixed(2))
              });
            }
            const newProfile: Profile = {
              id: Math.random().toString(36).substr(2, 9),
              type: "polygon",
              points: arcPts,
              isClosed: false
            };
            updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          }
          setDrawingPoints([]);
          setTempEndPoint(null);
        }
      } else if (currentTool === "polygon" || (currentTool as any) === "hexagon") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else {
          const center = curPts[0];
          const radius = Math.hypot(cadPoint.x - center.x, cadPoint.y - center.y);
          const startAngle = Math.atan2(cadPoint.y - center.y, cadPoint.x - center.x);
          const points: Point2D[] = [];
          for (let i = 0; i < 6; i++) {
            const angle = startAngle + (i / 6) * Math.PI * 2;
            points.push({
              x: parseFloat((center.x + Math.cos(angle) * radius).toFixed(2)),
              y: parseFloat((center.y + Math.sin(angle) * radius).toFixed(2))
            });
          }
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "hexagon",
            points,
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
          const center = curPts[0];
          const radius = Math.hypot(cadPoint.x - center.x, cadPoint.y - center.y);
          const startAngle = Math.atan2(cadPoint.y - center.y, cadPoint.x - center.x);
          const points: Point2D[] = [];
          for (let i = 0; i < 3; i++) {
            const angle = startAngle + (i / 3) * Math.PI * 2;
            points.push({
              x: parseFloat((center.x + Math.cos(angle) * radius).toFixed(2)),
              y: parseFloat((center.y + Math.sin(angle) * radius).toFixed(2))
            });
          }
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "triangle",
            points,
            isClosed: true
          };
          updateSketch({ ...curSketch, profiles: [...curSketch.profiles, newProfile] });
          setDrawingPoints([]);
          setTempEndPoint(null);
        }
      } else if (currentTool === "slot") {
        if (curPts.length === 0) {
          setDrawingPoints([cadPoint]);
        } else if (curPts.length === 1) {
          setDrawingPoints([curPts[0], cadPoint]);
        } else {
          const p1 = curPts[0];
          const p2 = curPts[1];
          const p3 = cadPoint;
          const v = { x: p2.x - p1.x, y: p2.y - p1.y };
          const len = Math.hypot(v.x, v.y);
          const r = Math.max(3, Math.abs((p2.y - p1.y) * p3.x - (p2.x - p1.x) * p3.y + p2.x * p1.y - p2.y * p1.x) / (len || 1));
          const ang = Math.atan2(v.y, v.x);
          const points: Point2D[] = [];
          const segCount = 12;
          for (let i = 0; i <= segCount; i++) {
            const a = (ang - Math.PI / 2) + (i / segCount) * Math.PI;
            points.push({
              x: parseFloat((p2.x + Math.cos(a) * r).toFixed(2)),
              y: parseFloat((p2.y + Math.sin(a) * r).toFixed(2))
            });
          }
          for (let i = 0; i <= segCount; i++) {
            const a = (ang + Math.PI / 2) + (i / segCount) * Math.PI;
            points.push({
              x: parseFloat((p1.x + Math.cos(a) * r).toFixed(2)),
              y: parseFloat((p1.y + Math.sin(a) * r).toFixed(2))
            });
          }
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

      const isModifier = e.ctrlKey || e.metaKey;
      const isDrawingTool = isActuallySketchModeRef.current && toolRef.current !== "select";

      // If actively using drawing tools (line, rect, circle, etc.) in 2D sketch mode,
      // prevent OrbitControls from rotating the view so the click cleanly draws geometry.
      if (isDrawingTool && e.button === 0 && !e.altKey) {
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
      } else {
        if (controlsRef.current && !controlsRef.current.enabled) {
          controlsRef.current.enabled = true;
        }
      }

      // Box selection: active if in select mode (or not drawing a sketch) AND Ctrl (or Cmd) is pressed
      const isSelectActive = !isActuallySketchModeRef.current || toolRef.current === "select";
      if (e.button === 0 && !e.altKey && isSelectActive && isModifier) {
        isBoxSelecting = true;
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
        return;
      }

      onSketchPointerDown(e);
    };

    const onPointerUp = (e: PointerEvent) => {
      draggingVertexRef.current = null;
      const diffX = Math.abs(e.clientX - startX);
      const diffY = Math.abs(e.clientY - startY);

      // Always restore orbit controls upon release
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }

      if (isBoxSelecting && (diffX >= 3 || diffY >= 3)) {
        // Selection window drag completed!
        // AutoCAD Standard:
        // - Left-to-Right (startX < currentX): Blue Window (only bodies completely inside window)
        // - Right-to-Left (startX > currentX): Green Crossing (any body that touches, intersects, or is inside window)
        if (renderer && camera) {
          const rect = renderer.domElement.getBoundingClientRect();
          const minX = Math.min(startX, e.clientX) - rect.left;
          const maxX = Math.max(startX, e.clientX) - rect.left;
          const minY = Math.min(startY, e.clientY) - rect.top;
          const maxY = Math.max(startY, e.clientY) - rect.top;

          const isCrossingSelection = startX > e.clientX; // Dragging right-to-left
          const capturedBodyIds: string[] = [];
          const tempVec = new THREE.Vector3();

          const targetGroup = importedMeshGroupRef.current;
          if (targetGroup) {
            targetGroup.children.forEach((child) => {
              if (child instanceof THREE.Mesh && child.userData?.type === "imported" && child.userData?.bodyId) {
                const bodyId = child.userData.bodyId;
                if (!child.geometry.boundingBox) {
                  child.geometry.computeBoundingBox();
                }
                const bbox = child.geometry.boundingBox;
                if (bbox) {
                  const corners = [
                    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
                    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
                    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
                    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
                    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
                    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
                    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
                    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z)
                  ];

                  let bodyScreenMinX = Infinity;
                  let bodyScreenMaxX = -Infinity;
                  let bodyScreenMinY = Infinity;
                  let bodyScreenMaxY = -Infinity;
                  let anyInFront = false;
                  let allCornersInside = true;

                  for (const corner of corners) {
                    tempVec.copy(corner).applyMatrix4(child.matrixWorld).project(camera);
                    if (tempVec.z >= -1 && tempVec.z <= 1) {
                      anyInFront = true;
                    }
                    const sx = ((tempVec.x + 1) / 2) * rect.width;
                    const sy = ((-tempVec.y + 1) / 2) * rect.height;

                    bodyScreenMinX = Math.min(bodyScreenMinX, sx);
                    bodyScreenMaxX = Math.max(bodyScreenMaxX, sx);
                    bodyScreenMinY = Math.min(bodyScreenMinY, sy);
                    bodyScreenMaxY = Math.max(bodyScreenMaxY, sy);

                    const isInside = sx >= minX && sx <= maxX && sy >= minY && sy <= maxY && tempVec.z >= -1 && tempVec.z <= 1;
                    if (!isInside) {
                      allCornersInside = false;
                    }
                  }

                  if (anyInFront) {
                    if (isCrossingSelection) {
                      const overlaps = !(bodyScreenMaxX < minX || bodyScreenMinX > maxX || bodyScreenMaxY < minY || bodyScreenMinY > maxY);
                      if (overlaps && !capturedBodyIds.includes(bodyId)) {
                        capturedBodyIds.push(bodyId);
                      }
                    } else {
                      const fullyContained = bodyScreenMinX >= minX && bodyScreenMaxX <= maxX && bodyScreenMinY >= minY && bodyScreenMaxY <= maxY;
                      if ((fullyContained || allCornersInside) && !capturedBodyIds.includes(bodyId)) {
                        capturedBodyIds.push(bodyId);
                      }
                    }
                  }
                }
              }
            });
          }

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

      if (diffX < 3 && diffY < 3) {
        onCanvasClick(e);
      }
    };

    let hoveredObject: THREE.Object3D | null = null;

    const onPointerMove = (event: PointerEvent) => {
      if (!mountRef.current || !renderer || !camera || !meshGroup) return;

      if (isBoxSelecting) {
        setSelectionBox({
          startX,
          startY,
          currentX: event.clientX,
          currentY: event.clientY
        });
        return;
      }

      const isSketchMode = isActuallySketchModeRef.current || !showSolid;
      if (isSketchMode) {
        const snapInfo = clientToPlaneCAD(event.clientX, event.clientY);
        setHoveredPoint(snapInfo.point);
        setActiveSnapType(snapInfo.type);
        setActiveGuides(snapInfo.guides || []);

        // Interactive vertex dragging in Select mode
        if (draggingVertexRef.current && activeSketchRef.current && onUpdateActiveSketchRef.current) {
          const { profileId, vertexIndex } = draggingVertexRef.current;
          const targetProf = activeSketchRef.current.profiles.find(p => p.id === profileId);
          if (targetProf && targetProf.points[vertexIndex]) {
            const updatedPoints = [...targetProf.points];
            updatedPoints[vertexIndex] = snapInfo.point;
            const updatedProf = { ...targetProf, points: updatedPoints };
            onUpdateActiveSketchRef.current({
              ...activeSketchRef.current,
              profiles: activeSketchRef.current.profiles.map(p => p.id === profileId ? updatedProf : p)
            });
          }
        }

        if (drawingPointsRef.current.length > 0) {
          setTempEndPoint(snapInfo.point);
        } else {
          setTempEndPoint(null);
        }
      }

      // Only perform heavy full-mesh raycasting on pointer move if in select mode, 3D solid mode, or picking a face/edge
      const shouldRaycastHover = isFacePickModeRef.current || !isActuallySketchModeRef.current || toolRef.current === "select" || edgeSelectionMode;
      if (shouldRaycastHover) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const candidateObjects: THREE.Object3D[] = [];
        if (meshGroup) candidateObjects.push(...meshGroup.children);
        if (importedMeshGroupRef.current) candidateObjects.push(...importedMeshGroupRef.current.children);
        const intersects = raycaster.intersectObjects(candidateObjects, true);

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
              foundInteractive = true;
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
      // Deselect all imported STEP bodies and confirm placement on Enter or Escape
      if (e.key === "Enter" || e.key === "Escape") {
        if (selectedImportedBodyIdsRef.current.length > 0) {
          setSelectedImportedBodyIds([]);
          // If the user was typing in an input inside the placement panel, blur it
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
      }

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
      const shouldRenderSolid = !isCurrentSketchActive || (showSolid && !isActuallySketchMode);

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

            // Render closed watertight shape shading (translucent face fill)
            if (profile.isClosed && profile.points.length >= 3) {
              try {
                const shape = new THREE.Shape();
                shape.moveTo(profile.points[0].x, profile.points[0].y);
                for (let i = 1; i < profile.points.length; i++) {
                  shape.lineTo(profile.points[i].x, profile.points[i].y);
                }
                shape.closePath();
                const fillGeo = new THREE.ShapeGeometry(shape);
                if (rawSketch.plane === "XY") {
                  fillGeo.rotateX(-Math.PI / 2);
                } else if (rawSketch.plane === "YZ") {
                  fillGeo.rotateY(-Math.PI / 2);
                }
                const fillMat = new THREE.MeshBasicMaterial({
                  color: isSelected ? 0x60a5fa : 0x3b82f6,
                  transparent: true,
                  opacity: isSelected ? 0.28 : 0.14,
                  side: THREE.DoubleSide,
                  depthWrite: false
                });
                const fillMesh = new THREE.Mesh(fillGeo, fillMat);
                if (rawSketch.plane === "XY") fillMesh.position.y += offset + 0.04;
                else if (rawSketch.plane === "XZ") fillMesh.position.z += offset + 0.04;
                else if (rawSketch.plane === "YZ") fillMesh.position.x += offset + 0.04;
                meshGroup.add(fillMesh);
              } catch (e) {
                // ignore invalid self-intersecting shape preview
              }
            }

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

                  // Subtract cut solid from native rendered solids
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

                  // Also subtract cut solid from imported STEP bodies with capped solid section material
                  if (importedMeshGroupRef.current) {
                    importedMeshGroupRef.current.children.forEach(child => {
                      if (child instanceof THREE.Mesh && child.userData?.type === "imported") {
                        try {
                          child.updateMatrix();
                          child.updateMatrixWorld(true);
                          const childCSG = CSG.fromMesh(child);
                          const subtractedCSG = childCSG.subtract(cutCSG);
                          const tempMesh = CSG.toMesh(subtractedCSG, child.matrixWorld, child.material as THREE.Material);

                          child.geometry.dispose();
                          child.geometry = tempMesh.geometry;

                          // Re-generate outline
                          const oldOutline = child.children.find(c => c instanceof THREE.LineSegments);
                          if (oldOutline) child.remove(oldOutline);
                          if (!showEdgesOnly) {
                            const edgesGeo = new THREE.EdgesGeometry(child.geometry, 35);
                            const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
                            child.add(edgeLines);
                          }
                        } catch (impCutErr) {
                          // Ignore CSG error for non-intersecting distant bodies
                        }
                      }
                    });
                  }
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
              } else if (op?.parameters.booleanOp === "join" && (renderedSolids.length > 0 || (importedMeshGroupRef.current && importedMeshGroupRef.current.children.length > 0))) {
                // Perform Boolean Union using CSG
                try {
                  solidMesh.updateMatrix();
                  solidMesh.updateMatrixWorld(true);
                  const joinCSG = CSG.fromMesh(solidMesh);

                  // Join with the first available solid (acting as base body)
                  const prevMesh = renderedSolids.length > 0 
                    ? renderedSolids[0] 
                    : (importedMeshGroupRef.current?.children.find(c => c instanceof THREE.Mesh) as THREE.Mesh | undefined);

                  if (prevMesh) {
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
                  } else {
                    meshGroup.add(solidMesh);
                    renderedSolids.push(solidMesh);
                    exportedMeshes.push(solidMesh);
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

    // Export all active scene meshes (sketches + imported STEP parts)
    const allActiveMeshes: THREE.Mesh[] = [...exportedMeshes];
    importedMeshGroupRef.current?.children.forEach(c => {
      if (c instanceof THREE.Mesh) allActiveMeshes.push(c);
    });
    if (onMeshCreatedRef.current) {
      onMeshCreatedRef.current(allActiveMeshes);
    }
  }, [
    activeSketch,
    sketches,
    operations,
    material,
    showEdgesOnly,
    showSolid,
    selectedFaceInfo,
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
    isActuallySketchMode
  ]);

  // Highly optimized imported bodies rendering & memory management for large assemblies (350MB+ STEP files)
  // 1. Heavy Geometry Build: Runs ONLY when importedBodies change (e.g. initial load or body delete/add).
  useEffect(() => {
    const importedGroup = importedMeshGroupRef.current;
    if (!importedGroup) return;

    // Track existing imported meshes in importedMeshGroup
    const existingMeshesMap = new Map<string, THREE.Mesh>();

    importedGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData?.type === "imported" && child.userData?.bodyId) {
        existingMeshesMap.set(child.userData.bodyId, child);
      }
    });

    const currentBodyIds = new Set((importedBodies || []).map(b => b.id));

    // Remove deleted bodies from scene and dispose buffers immediately to free GPU VRAM
    existingMeshesMap.forEach((mesh, bodyId) => {
      if (!currentBodyIds.has(bodyId)) {
        importedGroup.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });

    if (importedBodies && importedBodies.length > 0) {
      importedBodies.forEach((body) => {
        let mesh = existingMeshesMap.get(body.id);

        if (!mesh) {
          // Retrieve raw geometry buffers from high-performance cache (bypassing React memory clone)
          const cachedData = bodyGeometryCache.get(body.id);
          const rawVerts = (cachedData && cachedData.vertices.length > 0) ? cachedData.vertices : body.vertices;
          const rawNorms = cachedData?.normals || body.normals;
          const rawInds = cachedData?.indices || body.indices;

          if (!rawVerts || rawVerts.length === 0) return;

          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.Float32BufferAttribute(rawVerts, 3));

          if (rawNorms && rawNorms.length > 0) {
            geom.setAttribute("normal", new THREE.Float32BufferAttribute(rawNorms, 3));
          } else {
            geom.computeVertexNormals();
          }

          if (rawInds && rawInds.length > 0) {
            geom.setIndex(new THREE.BufferAttribute(new Uint32Array(rawInds), 1));
          }

          // Precompute bounding box once so raycasting and box-select are instant
          geom.computeBoundingBox();

          const bodyMat = new THREE.MeshStandardMaterial({
            color: body.color ? new THREE.Color(body.color[0], body.color[1], body.color[2]) : new THREE.Color(material.color),
            roughness: 0.35,
            metalness: 0.25,
            side: THREE.DoubleSide,
            wireframe: showEdgesOnly,
            transparent: showEdgesOnly || material.opacity < 1,
            opacity: showEdgesOnly ? 0.35 : (body.color ? 1.0 : material.opacity),
            emissive: new THREE.Color(0x000000),
            emissiveIntensity: 0.0
          });

          mesh = new THREE.Mesh(geom, bodyMat);
          mesh.userData = { type: "imported", bodyId: body.id, baseColor: body.color || material.color };
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.name = body.name;

          const edgesGeo = new THREE.EdgesGeometry(geom, 35);
          const edgeLines = new THREE.LineSegments(
            edgesGeo,
            new THREE.LineBasicMaterial({
              color: 0x18181b,
              linewidth: 1.2,
              transparent: true,
              opacity: 0.65
            })
          );
          edgeLines.visible = !showEdgesOnly;
          mesh.add(edgeLines);

          importedGroup.add(mesh);
        }

        // Fast transform update (no buffer reallocation)
        const posX = body.position ? body.position[0] : 0;
        const posY = body.position ? body.position[1] : 0;
        const posZ = body.position ? body.position[2] : 0;

        const rotX = body.rotation ? (body.rotation[0] * Math.PI) / 180 : 0;
        const rotY = body.rotation ? (body.rotation[1] * Math.PI) / 180 : 0;
        const rotZ = body.rotation ? (body.rotation[2] * Math.PI) / 180 : 0;

        const sclX = body.scale ? body.scale[0] : 1;
        const sclY = body.scale ? body.scale[1] : 1;
        const sclZ = body.scale ? body.scale[2] : 1;

        mesh.position.set(posX, posY, posZ);
        mesh.rotation.set(rotX, rotY, rotZ, 'ZYX');
        mesh.scale.set(sclX, sclY, sclZ);
        mesh.updateMatrix();
      });
    }

    // Export scene meshes for STEP export
    const allMeshes: THREE.Mesh[] = [];
    meshGroupRef.current?.children.forEach(c => { if (c instanceof THREE.Mesh) allMeshes.push(c); });
    importedGroup.children.forEach(c => { if (c instanceof THREE.Mesh) allMeshes.push(c); });
    if (onMeshCreatedRef.current) {
      onMeshCreatedRef.current(allMeshes);
    }

  }, [importedBodies]);

  // 2. Instantaneous Zero-Cost Selection Highlighter: Modifies material emissive in 0ms without rebuilding buffers
  useEffect(() => {
    const importedGroup = importedMeshGroupRef.current;
    if (!importedGroup) return;
    const selectedSet = new Set(selectedImportedBodyIds);

    importedGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData?.type === "imported" && child.userData?.bodyId) {
        const isSelected = selectedSet.has(child.userData.bodyId);
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.emissive.set(isSelected ? 0x3b82f6 : 0x000000);
          mat.emissiveIntensity = isSelected ? 0.45 : 0.0;
        }
      }
    });
  }, [selectedImportedBodyIds]);

  // Synchronize wireframe and edge outlines on imported meshes when showEdgesOnly toggles
  useEffect(() => {
    const importedGroup = importedMeshGroupRef.current;
    if (!importedGroup) return;
    importedGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData?.type === "imported") {
        if (child.material && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.wireframe = showEdgesOnly;
          child.material.transparent = showEdgesOnly;
          child.material.opacity = showEdgesOnly ? 0.35 : 1.0;
          child.material.needsUpdate = true;
        }
        const outline = child.children.find(c => c instanceof THREE.LineSegments);
        if (outline) {
          outline.visible = !showEdgesOnly;
        }
      }
    });
  }, [showEdgesOnly]);

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

    if ((!isActuallySketchMode && showSolid) || !activeSketch) return;

    // Render active in-progress drawing lines (rubberband) in 3D
    if (drawingPoints.length > 0) {
      const activePts = [...drawingPoints];
      if (tempEndPoint) {
        if (tool === "rectangle") {
          const p1 = activePts[0];
          const p2 = tempEndPoint;
          activePts.push({ x: p2.x, y: p1.y }, p2, { x: p1.x, y: p2.y }, p1);
        } else if (tool === "rectangle-center") {
          const center = activePts[0];
          const dx = Math.abs(tempEndPoint.x - center.x);
          const dy = Math.abs(tempEndPoint.y - center.y);
          activePts.length = 0;
          activePts.push(
            { x: center.x - dx, y: center.y - dy },
            { x: center.x + dx, y: center.y - dy },
            { x: center.x + dx, y: center.y + dy },
            { x: center.x - dx, y: center.y + dy },
            { x: center.x - dx, y: center.y - dy }
          );
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
        } else if (tool === "arc") {
          if (activePts.length === 1) {
            activePts.push(tempEndPoint);
          } else if (activePts.length === 2) {
            const p1 = activePts[0];
            const p2 = activePts[1];
            const p3 = tempEndPoint;
            const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
            if (Math.abs(D) < 1e-4) {
              activePts.push(tempEndPoint);
            } else {
              const cx = ((p1.x*p1.x + p1.y*p1.y)*(p2.y - p3.y) + (p2.x*p2.x + p2.y*p2.y)*(p3.y - p1.y) + (p3.x*p3.x + p3.y*p3.y)*(p1.y - p2.y)) / D;
              const cy = ((p1.x*p1.x + p1.y*p1.y)*(p3.x - p2.x) + (p2.x*p2.x + p2.y*p2.y)*(p1.x - p3.x) + (p3.x*p3.x + p3.y*p3.y)*(p2.x - p1.x)) / D;
              const radius = Math.hypot(p1.x - cx, p1.y - cy);
              let a1 = Math.atan2(p1.y - cy, p1.x - cx);
              let a2 = Math.atan2(p2.y - cy, p2.x - cx);
              let a3 = Math.atan2(p3.y - cy, p3.x - cx);
              const norm = (a: number) => (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
              const na1 = norm(a1);
              const na2 = norm(a2);
              const na3 = norm(a3);
              const isBetweenCCW = (start: number, mid: number, end: number) => {
                const diffEnd = (end - start + 2 * Math.PI) % (2 * Math.PI);
                const diffMid = (mid - start + 2 * Math.PI) % (2 * Math.PI);
                return diffMid < diffEnd;
              };
              const ccw = isBetweenCCW(na1, na2, na3);
              const arcPts: Point2D[] = [];
              const steps = 24;
              let sweep = ccw 
                ? ((na3 - na1 + 2 * Math.PI) % (2 * Math.PI)) 
                : -((na1 - na3 + 2 * Math.PI) % (2 * Math.PI));
              for (let s = 0; s <= steps; s++) {
                const ang = a1 + (sweep * s) / steps;
                arcPts.push({
                  x: cx + radius * Math.cos(ang),
                  y: cy + radius * Math.sin(ang)
                });
              }
              activePts.length = 0;
              activePts.push(...arcPts);
            }
          }
        } else if (tool === "polygon" || (tool as any) === "hexagon") {
          const center = activePts[0];
          const radius = Math.hypot(tempEndPoint.x - center.x, tempEndPoint.y - center.y);
          const startAngle = Math.atan2(tempEndPoint.y - center.y, tempEndPoint.x - center.x);
          const hexPts: Point2D[] = [];
          for (let i = 0; i <= 6; i++) {
            const angle = startAngle + (i / 6) * Math.PI * 2;
            hexPts.push({
              x: center.x + Math.cos(angle) * radius,
              y: center.y + Math.sin(angle) * radius
            });
          }
          activePts.length = 0;
          activePts.push(...hexPts);
        } else if (tool === "triangle") {
          const center = activePts[0];
          const radius = Math.hypot(tempEndPoint.x - center.x, tempEndPoint.y - center.y);
          const startAngle = Math.atan2(tempEndPoint.y - center.y, tempEndPoint.x - center.x);
          const triPts: Point2D[] = [];
          for (let i = 0; i <= 3; i++) {
            const angle = startAngle + (i / 3) * Math.PI * 2;
            triPts.push({
              x: center.x + Math.cos(angle) * radius,
              y: center.y + Math.sin(angle) * radius
            });
          }
          activePts.length = 0;
          activePts.push(...triPts);
        } else if (tool === "slot") {
          if (activePts.length === 1) {
            activePts.push(tempEndPoint);
          } else if (activePts.length === 2) {
            const p1 = activePts[0];
            const p2 = activePts[1];
            const p3 = tempEndPoint;
            const v = { x: p2.x - p1.x, y: p2.y - p1.y };
            const len = Math.hypot(v.x, v.y);
            const r = Math.max(3, Math.abs((p2.y - p1.y) * p3.x - (p2.x - p1.x) * p3.y + p2.x * p1.y - p2.y * p1.x) / (len || 1));
            const ang = Math.atan2(v.y, v.x);
            const slotPts: Point2D[] = [];
            const segCount = 12;
            for (let i = 0; i <= segCount; i++) {
              const a = (ang - Math.PI / 2) + (i / segCount) * Math.PI;
              slotPts.push({ x: p2.x + Math.cos(a) * r, y: p2.y + Math.sin(a) * r });
            }
            for (let i = 0; i <= segCount; i++) {
              const a = (ang + Math.PI / 2) + (i / segCount) * Math.PI;
              slotPts.push({ x: p1.x + Math.cos(a) * r, y: p1.y + Math.sin(a) * r });
            }
            slotPts.push(slotPts[0]);
            activePts.length = 0;
            activePts.push(...slotPts);
          }
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
    if (!showSolid && activeSketch && (!importedBodies || importedBodies.length === 0)) {
      const timer = setTimeout(() => {
        alignCameraToSketchPlane();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showSolid, activeSketch.id, activeSketch.plane, activeSketch.offset, importedBodies?.length]);

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
    const importedMeshGroup = importedMeshGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!meshGroup || !camera || !controls) return;

    const box = new THREE.Box3();
    let hasGeom = false;

    const checkChild = (child: THREE.Object3D) => {
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
    };

    meshGroup.traverse(checkChild);
    if (importedMeshGroup) {
      importedMeshGroup.traverse(checkChild);
    }

    if (!hasGeom) {
      handleResetCamera();
      return;
    }

    const center = new THREE.Vector3();
    box.getCenter(center);

    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z, 20);
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
      // Restore standard 3D free orbit camera orientation
      if (cameraRef.current && controlsRef.current) {
        cameraRef.current.up.set(0, 1, 0);
        controlsRef.current.enableRotate = true;
        controlsRef.current.enableZoom = true;
        controlsRef.current.enablePan = true;
      }
      requestAnimationFrame(() => {
        handleZoomToFit();
      });
    }
    prevImportedIdsRef.current = currentIds;
  }, [importedBodies]);

  return (
    <div className="flex flex-col h-full bg-panel border border-border-main rounded overflow-hidden shadow-2xl relative">
      {/* CAD Bar Header (Tier 1: Main Viewport Bar) */}
      <div className="flex items-center justify-between px-4 py-2 bg-panel border-b border-border-main z-10 select-none">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-500/10 rounded border border-blue-500/20 text-blue-400">
            <Box size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-sans font-bold text-xs text-text-main uppercase tracking-[1px]">Vista Interactiva 3D</h3>
              {isActuallySketchMode ? (
                <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                  <Sparkles size={11} className="animate-pulse" />
                  <span>Modo Boceto: {activeSketch.name} ({activeSketch.plane})</span>
                </span>
              ) : (
                <span className="text-[10px] bg-blue-500/15 border border-blue-500/30 text-blue-400 font-bold px-2 py-0.5 rounded">
                  Modo Sólido 3D
                </span>
              )}
            </div>
            <p className="text-[10px] text-text-muted font-mono leading-none mt-0.5">Render WebGL acelerado B-Rep</p>
          </div>
        </div>

        {/* Header Right Controls */}
        <div className="flex items-center gap-2 overflow-x-auto py-0.5">
          {!isActuallySketchMode ? (
            /* SOLID 3D VIEWPORT HEADER CONTROLS */
            <div className="flex items-center gap-2">
              {/* Prominent Enter Sketch Mode Button */}
              <button
                onClick={handleStartSketchMode}
                className="p-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-all cursor-pointer border border-blue-400/30"
                title="Editar este boceto en 2D/3D con herramientas CAD"
              >
                <PenTool size={13} />
                <span>✏️ Editar Boceto ({activeSketch.name})</span>
              </button>

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

              {/* Button to Align in True Magnitude */}
              <button
                onClick={alignCameraToSketchPlane}
                className="p-1.5 px-2.5 rounded flex items-center gap-1.5 text-xs font-semibold border border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all cursor-pointer"
                title="Alinear vista de cámara en Verdadera Magnitud perpendicular al plano de boceto"
              >
                <Compass size={13} />
                <span>Verdadera Magnitud</span>
              </button>
            </div>
          ) : null}

          {/* Solid Boolean Ops Tools (Only in 3D Solid Mode) */}
          {!isActuallySketchMode && showSolid && (
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
            className={`p-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
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
            className={`p-1.5 px-2.5 rounded flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer ${
              viewportTheme === "light" 
                ? "bg-amber-500/20 text-amber-500 border-amber-500/40" 
                : "bg-surface text-text-muted border-border-subtle hover:bg-highlight-subtle hover:text-text-main"
            }`}
            title="Cambiar tema de la vista 3D (Fondo Claro CAD / Oscuro)"
          >
            <Sun size={13} />
            <span>{viewportTheme === "light" ? "Claro" : "Oscuro"}</span>
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

      {/* CAD Sketch Ribbon Toolbar (Tier 2: Dedicated Ribbon when in Sketch Mode) */}
      {isActuallySketchMode && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-panel/95 border-b border-border-main z-10 gap-2 overflow-x-auto select-none shadow-sm">
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Tool Selector Buttons */}
            <div className="flex items-center bg-surface p-0.5 rounded border border-border-subtle gap-0.5">
              <button
                onClick={() => { setTool("select"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "select" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Seleccionar / Manipular Vértices y Áreas (S)"
              >
                <MousePointer2 size={13} />
                <span>Selec</span>
              </button>

              <button
                onClick={() => { setTool("line"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "line" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Línea / Polilínea (L) - Clic para cerrar o Enter para finalizar abierta"
              >
                <PenTool size={13} />
                <span>Línea</span>
              </button>

              <button
                onClick={() => { setTool("rectangle"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "rectangle" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Rectángulo 2 Puntos (R)"
              >
                <Square size={13} />
                <span>Rect (2P)</span>
              </button>

              <button
                onClick={() => { setTool("rectangle-center"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "rectangle-center" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Rectángulo con Centro (Shift+R)"
              >
                <SquareDot size={13} />
                <span>Rect (Ctr)</span>
              </button>

              <button
                onClick={() => { setTool("circle"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "circle" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Círculo Centro-Radio (C)"
              >
                <Circle size={13} />
                <span>Círculo</span>
              </button>

              <button
                onClick={() => { setTool("arc"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "arc" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Arco 3 Puntos (A)"
              >
                <CircleDashed size={13} />
                <span>Arco</span>
              </button>

              <button
                onClick={() => { setTool("hexagon"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "hexagon" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Polígono Regular / Hexágono (H)"
              >
                <Hexagon size={13} />
                <span>Polígono</span>
              </button>

              <button
                onClick={() => { setTool("triangle"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "triangle" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Triángulo (T)"
              >
                <Triangle size={13} />
                <span>Triáng</span>
              </button>

              <button
                onClick={() => { setTool("slot"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "slot" ? "bg-blue-600 text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-highlight-subtle"
                }`}
                title="Ranura / Slot Redondeado (O)"
              >
                <Split size={13} />
                <span>Ranura</span>
              </button>

              <button
                onClick={() => { setTool("trim"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "trim" ? "bg-amber-500 text-black font-bold shadow-sm" : "text-text-muted hover:text-amber-400 hover:bg-highlight-subtle"
                }`}
                title="Recortar Segmentos (X)"
              >
                <Scissors size={13} />
                <span>Recortar</span>
              </button>

              <button
                onClick={() => { setTool("erase"); setDrawingPoints([]); setTempEndPoint(null); }}
                className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                  tool === "erase" ? "bg-red-600 text-white shadow-sm" : "text-red-400 hover:text-white hover:bg-red-600/80"
                }`}
                title="Borrador Directo (Clic en figura)"
              >
                <Trash2 size={13} />
                <span>Borrar</span>
              </button>
            </div>

            {/* OSNAP Magnet Button */}
            <button
              onClick={() => setOsnapSettings(prev => ({ ...prev, vertex: !prev.vertex, grid: !prev.grid }))}
              className={`p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold border transition-all cursor-pointer ${
                osnapSettings.vertex || osnapSettings.grid
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                  : "bg-surface text-text-muted border-border-subtle hover:text-text-main"
              }`}
              title="Ajuste Magnético OSNAP (Vértices y Rejilla)"
            >
              <Magnet size={13} />
              <span>Snap {osnapSettings.vertex ? "ON" : "OFF"}</span>
            </button>

            {/* Delete Selected Profiles Button */}
            {selectedProfileIds.length > 0 && (
              <button
                onClick={handleDeleteSelectedProfiles}
                className="p-1.5 px-2.5 rounded flex items-center gap-1 text-xs font-bold bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/50 shadow-sm transition-all cursor-pointer animate-fade-in"
                title="Eliminar figuras seleccionadas (Supr)"
              >
                <Trash2 size={13} />
                <span>Eliminar ({selectedProfileIds.length})</span>
              </button>
            )}

            {/* Clear Entire Sketch Button */}
            {activeSketch.profiles.length > 0 && (
              <button
                onClick={handleClearSketch}
                className="p-1.5 px-2 rounded flex items-center gap-1 text-xs text-text-muted hover:text-red-400 hover:bg-surface border border-border-subtle transition-all cursor-pointer"
                title="Limpiar todas las figuras de este boceto"
              >
                <span>Vaciar</span>
              </button>
            )}

            {/* Align Camera */}
            <button
              onClick={alignCameraToSketchPlane}
              className="p-1.5 px-2 rounded flex items-center gap-1 text-xs font-semibold border border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all cursor-pointer"
              title="Alinear vista perpendicular al plano de boceto"
            >
              <Compass size={13} />
              <span>Plano</span>
            </button>
          </div>

          {/* Right Action CTAs: Direct Extrude & Finish Sketch */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Direct Extrude Button (High-profile CAD Action) */}
            <button
              onClick={() => {
                if (selectedShapeIndices.length === 0 && onSelectAllShapes) {
                  onSelectAllShapes();
                }
                setSelectedProfileIds([]);
                setShowExtrudeCard(true);
              }}
              className="p-1.5 px-3.5 rounded flex items-center gap-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all active:scale-95 cursor-pointer border border-amber-400/60"
              title="Extruir áreas cerradas del boceto directamente a sólido 3D"
            >
              <Sparkles size={14} className="text-black stroke-[2.5]" />
              <span>⚡ Extruir Boceto</span>
            </button>

            {/* Finish Sketch Button */}
            <button
              onClick={handleFinishSketch}
              className="p-1.5 px-3 rounded flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.35)] transition-all active:scale-95 cursor-pointer border border-emerald-400/50"
              title="Terminar edición del boceto y volver a sólidos 3D"
            >
              <Check size={14} className="stroke-[3]" />
              <span>Terminar Boceto</span>
            </button>
          </div>
        </div>
      )}

      {/* Render canvas viewport container */}
      <div className="flex-1 w-full relative overflow-hidden transition-all duration-300 select-none" style={{ backgroundColor: viewportTheme === "light" ? "#f1f5f9" : "#0d0e11", backgroundImage: viewportTheme === "light" ? "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)" : "radial-gradient(circle at 1.5px 1.5px, rgba(255, 255, 255, 0.05) 1px, transparent 0)", backgroundSize: viewportTheme === "light" ? "100% 100%" : "32px 32px" }}>
        {/* Dedicated 3D WebGL Canvas Mount - pure Three.js container with NO React DOM children */}
        <div ref={mountRef} className="w-full h-full absolute inset-0" />

        {/* Selection Box Visual Rectangle (Green Crossing vs Blue Window) */}
        {selectionBox && (() => {
          const mountRect = mountRef.current?.getBoundingClientRect();
          if (!mountRect) return null;
          const left = Math.min(selectionBox.startX, selectionBox.currentX) - mountRect.left;
          const top = Math.min(selectionBox.startY, selectionBox.currentY) - mountRect.top;
          const width = Math.abs(selectionBox.currentX - selectionBox.startX);
          const height = Math.abs(selectionBox.currentY - selectionBox.startY);

          // Right-to-Left drag: Green Crossing (dashed border)
          // Left-to-Right drag: Blue Window (solid border)
          const isCrossing = selectionBox.startX > selectionBox.currentX;

          return (
            <div
              className={`absolute pointer-events-none rounded z-30 ${
                isCrossing
                  ? "border-2 border-dashed border-emerald-400 bg-emerald-500/25 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                  : "border-2 border-solid border-blue-400 bg-blue-500/25 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
              }`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`
              }}
            >
              <div className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider backdrop-blur-sm bg-black/60 text-white flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isCrossing ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                <span>{isCrossing ? "Captura (Verde)" : "Ventana (Azul)"}</span>
              </div>
            </div>
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

      {/* Floating 2D Sketch Properties Panel Overlay in 3D Mode */}
      {!showSolid && tool === "select" && selectedProfileIds.length >= 1 && !isSelectingMirrorAxis && (
        <SketchPropertiesPanel 
          activeSketch={activeSketch}
          selectedProfileIdsList={selectedProfileIds}
          setSelectedProfileIds={setSelectedProfileIds}
          onUpdateActiveSketch={onUpdateActiveSketch}
          onClose={() => setSelectedProfileIds([])}
          onExtrudeProfile={(profileId: string) => {
            if (onSelectAllShapes) onSelectAllShapes();
            setSelectedProfileIds([]);
            setShowExtrudeCard(true);
          }}
          onStartCustomMirror={(isCopy: boolean) => {
            setCustomMirrorCopyState(isCopy);
            setIsSelectingMirrorAxis(true);
            setPendingMirrorPoints([]);
          }}
        />
      )}

      {/* Sketch Drawing Help HUD (Non-overlapping bottom-left positioning) */}
      {isActuallySketchMode && (
        <div className="absolute bottom-20 left-4 z-20 pointer-events-auto bg-[#121214]/90 backdrop-blur-md border border-emerald-500/30 p-2.5 rounded-lg text-xs flex flex-col gap-1.5 shadow-2xl transition-all max-w-xs select-none animate-fadeIn">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle/60 pb-1">
            <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
              <Sparkles size={12} />
              <span>Modo Boceto: {activeSketch?.name}</span>
            </div>
            <button
              onClick={() => setIsHudCollapsed(!isHudCollapsed)}
              className="text-[10px] text-text-muted hover:text-text-main px-1.5 py-0.5 rounded bg-surface border border-border-subtle cursor-pointer transition-colors"
            >
              {isHudCollapsed ? "▲ Info" : "▼ Ocultar"}
            </button>
          </div>

          {!isHudCollapsed && (
            <div className="text-[10px] text-text-muted flex flex-col gap-0.5">
              <div>• <b className="text-text-main">Herramienta:</b> <span className="text-blue-400 font-semibold uppercase">{tool}</span></div>
              <div>• <b className="text-text-main">Clic Izq:</b> Dibujar / Clic en área para seleccionarla</div>
              <div>• <b className="text-text-main">Enter / 2-Clic:</b> Terminar polilínea</div>
              <div>• <b className="text-text-main">Clic Der / Rueda:</b> Orbitar 3D / Pan / Zoom</div>
              <div>• <b className="text-text-main">Esc:</b> Cancelar trazo</div>
            </div>
          )}

          {hoveredPoint && (
            <div className="flex flex-col gap-1 border-t border-border-subtle/60 pt-1 mt-0.5 font-mono text-[10px]">
              <div className="flex items-center justify-between text-emerald-400 font-bold">
                <span>X: {hoveredPoint.x.toFixed(2)} mm</span>
                <span>Y: {hoveredPoint.y.toFixed(2)} mm</span>
                {activeSnapType !== 'none' && (
                  <span className="text-amber-400 font-bold bg-amber-500/10 px-1 rounded border border-amber-500/30">
                    Snap: {activeSnapType}
                  </span>
                )}
              </div>
              {drawingPoints.length > 0 && tempEndPoint && (() => {
                const pStart = drawingPoints[drawingPoints.length - 1];
                const dx = tempEndPoint.x - pStart.x;
                const dy = tempEndPoint.y - pStart.y;
                const len = Math.hypot(dx, dy);
                let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
                if (deg < 0) deg += 360;
                return (
                  <div className="flex items-center justify-between text-cyan-300 font-bold bg-blue-950/40 p-1 rounded border border-blue-500/20">
                    <span>Longitud: {len.toFixed(2)} mm</span>
                    <span className="text-amber-300">Ángulo: {deg.toFixed(1)}°</span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Floating Boolean Op Configurator */}
      {showSolid && activeSolidOp !== "none" && (
        <div className="absolute top-4 right-4 z-20 bg-[#121214]/95 backdrop-blur-md border border-amber-500/40 p-4 rounded-xl shadow-[0_10px_35px_rgba(0,0,0,0.6)] w-72 pointer-events-auto flex flex-col gap-3 transition-all animate-fadeIn">
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

        const applyTransformationToSelectedBodies = (matrix: THREE.Matrix4) => {
          // Direct transformation on existing Three.js scene meshes (0-allocation)
          if (importedMeshGroupRef.current) {
            importedMeshGroupRef.current.children.forEach(child => {
              if (child instanceof THREE.Mesh && selectedImportedBodyIds.includes(child.userData?.bodyId)) {
                child.geometry.applyMatrix4(matrix);
                child.geometry.computeVertexNormals();
                child.geometry.computeBoundingBox();
              }
            });
          }

          // Update lightweight metadata in React state without copying Float32Arrays
          const idSet = new Set(selectedImportedBodyIds);
          const updatedList = importedBodies.map(b => {
            if (!idSet.has(b.id)) return b;
            const mesh = importedMeshGroupRef.current?.children.find(c => c instanceof THREE.Mesh && c.userData?.bodyId === b.id) as THREE.Mesh;
            const posAttr = mesh?.geometry.getAttribute("position");
            const normAttr = mesh?.geometry.getAttribute("normal");
            return {
              ...b,
              vertices: posAttr ? (posAttr.array as Float32Array) : b.vertices,
              normals: normAttr ? (normAttr.array as Float32Array) : b.normals,
              position: [0, 0, 0] as [number, number, number],
              rotation: [0, 0, 0] as [number, number, number],
              scale: [1, 1, 1] as [number, number, number]
            };
          });

          if (onUpdateImportedBodiesRef.current) {
            onUpdateImportedBodiesRef.current(updatedList);
          }
        };

        const computeCenter = (): THREE.Vector3 => {
          const overallBox = new THREE.Box3();
          if (importedMeshGroupRef.current) {
            importedMeshGroupRef.current.children.forEach(child => {
              if (child instanceof THREE.Mesh && selectedImportedBodyIds.includes(child.userData?.bodyId)) {
                if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                if (child.geometry.boundingBox) {
                  const box = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
                  overallBox.union(box);
                }
              }
            });
          }
          const c = new THREE.Vector3();
          overallBox.getCenter(c);
          return c;
        };

        return (
          <div className="absolute top-4 right-4 z-30 bg-[#121214]/95 backdrop-blur-md border border-blue-500/50 p-4 rounded-xl shadow-[0_10px_35px_rgba(0,0,0,0.6)] w-80 pointer-events-auto flex flex-col gap-3 transition-all animate-fadeIn">
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

            {/* Quick Action: Create Sketch Plane on Face */}
            <button
              type="button"
              onClick={() => {
                setIsFacePickMode(true);
                onShowToastRef.current?.("Modo selección de cara activo: haz clic sobre cualquier cara para crear el boceto", "info");
              }}
              className="w-full py-2 px-3 bg-gradient-to-r from-emerald-600/30 to-blue-600/30 hover:from-emerald-600/50 hover:to-blue-600/50 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 hover:text-emerald-100 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer active:scale-95 group"
              title="Activar selección de caras para crear un plano de boceto sobre esta pieza"
            >
              <Sparkles size={14} className="text-emerald-400 group-hover:rotate-12 transition-transform" />
              <span>Crear Plano de Boceto en Cara</span>
            </button>

            {/* Transform Controls */}
            <div className="flex flex-col gap-2.5 text-xs">
              {/* Position (Mover en mm) */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Desplazar Posición (mm personalizados)</span>
                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {(['x', 'y', 'z'] as const).map((axis) => {
                    const label = axis.toUpperCase();
                    const val = parseFloat(customMoveStep[axis]) || 0;
                    return (
                      <div key={axis} className="flex flex-col gap-1 bg-black/40 border border-border-subtle rounded p-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[10px] font-bold ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-green-400' : 'text-blue-400'}`}>
                            {label}
                          </span>
                          <input
                            type="number"
                            value={customMoveStep[axis]}
                            onChange={(e) => setCustomMoveStep(prev => ({ ...prev, [axis]: e.target.value }))}
                            className="w-12 bg-black/60 border border-border-subtle text-text-main text-[10px] text-right font-mono px-1 py-0.5 rounded focus:border-blue-500 outline-none"
                            placeholder="10"
                            step="1"
                          />
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const step = parseFloat(customMoveStep[axis]) || 0;
                              if (step === 0) return;
                              const mat = new THREE.Matrix4();
                              if (axis === 'x') mat.makeTranslation(-step, 0, 0);
                              else if (axis === 'y') mat.makeTranslation(0, -step, 0);
                              else mat.makeTranslation(0, 0, -step);
                              applyTransformationToSelectedBodies(mat);
                            }}
                            className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[10px] font-bold rounded border border-border-subtle cursor-pointer transition-colors"
                            title={`Mover -${val}mm en eje ${label}`}
                          >
                            -{val || 10}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const step = parseFloat(customMoveStep[axis]) || 0;
                              if (step === 0) return;
                              const mat = new THREE.Matrix4();
                              if (axis === 'x') mat.makeTranslation(step, 0, 0);
                              else if (axis === 'y') mat.makeTranslation(0, step, 0);
                              else mat.makeTranslation(0, 0, step);
                              applyTransformationToSelectedBodies(mat);
                            }}
                            className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[10px] font-bold rounded border border-border-subtle cursor-pointer transition-colors"
                            title={`Mover +${val}mm en eje ${label}`}
                          >
                            +{val || 10}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rotation (Girar 3D sobre su Centro) */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    {isSingle ? "Rotar Pieza (Giro personalizado °)" : `Rotar Conjunto (${selectedBodies.length} Piezas)`}
                  </span>
                  <span className="text-[9px] text-blue-400 font-mono">Pivote: Centro 3D</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {(['x', 'y', 'z'] as const).map((axis) => {
                    const label = axis.toUpperCase();
                    const val = parseFloat(customRotateStep[axis]) || 0;
                    return (
                      <div key={axis} className="flex flex-col gap-1 bg-black/40 border border-border-subtle rounded p-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[10px] font-bold ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-green-400' : 'text-blue-400'}`}>
                            Eje {label}
                          </span>
                          <input
                            type="number"
                            value={customRotateStep[axis]}
                            onChange={(e) => setCustomRotateStep(prev => ({ ...prev, [axis]: e.target.value }))}
                            className="w-12 bg-black/60 border border-border-subtle text-text-main text-[10px] text-right font-mono px-1 py-0.5 rounded focus:border-blue-500 outline-none"
                            placeholder="90"
                            step="1"
                          />
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const deg = parseFloat(customRotateStep[axis]) || 0;
                              if (deg === 0) return;
                              const center = computeCenter();
                              const rad = (-deg * Math.PI) / 180;
                              const rotMat = new THREE.Matrix4();
                              if (axis === 'x') rotMat.makeRotationX(rad);
                              else if (axis === 'y') rotMat.makeRotationY(rad);
                              else rotMat.makeRotationZ(rad);

                              const transformMat = new THREE.Matrix4()
                                .makeTranslation(center.x, center.y, center.z)
                                .multiply(rotMat)
                                .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

                              applyTransformationToSelectedBodies(transformMat);
                            }}
                            className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[10px] font-bold rounded border border-border-subtle cursor-pointer transition-colors"
                            title={`Rotar -${val}° en eje ${label} sobre su centro`}
                          >
                            -{val || 90}°
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const deg = parseFloat(customRotateStep[axis]) || 0;
                              if (deg === 0) return;
                              const center = computeCenter();
                              const rad = (deg * Math.PI) / 180;
                              const rotMat = new THREE.Matrix4();
                              if (axis === 'x') rotMat.makeRotationX(rad);
                              else if (axis === 'y') rotMat.makeRotationY(rad);
                              else rotMat.makeRotationZ(rad);

                              const transformMat = new THREE.Matrix4()
                                .makeTranslation(center.x, center.y, center.z)
                                .multiply(rotMat)
                                .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

                              applyTransformationToSelectedBodies(transformMat);
                            }}
                            className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[10px] font-bold rounded border border-border-subtle cursor-pointer transition-colors"
                            title={`Rotar +${val}° en eje ${label} sobre su centro`}
                          >
                            +{val || 90}°
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scale (Escalar) */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Escala (Multiplicador Uniforme)</span>
                <div className="flex gap-1.5 font-mono">
                  <button
                    type="button"
                    onClick={() => {
                      const center = computeCenter();
                      const sclMat = new THREE.Matrix4().makeScale(0.8, 0.8, 0.8);
                      const transformMat = new THREE.Matrix4()
                        .makeTranslation(center.x, center.y, center.z)
                        .multiply(sclMat)
                        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
                      applyTransformationToSelectedBodies(transformMat);
                    }}
                    className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[10px] font-bold rounded border border-border-subtle cursor-pointer transition-colors"
                    title="Reducir escala (-20%)"
                  >
                    × 0.8
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const center = computeCenter();
                      const sclMat = new THREE.Matrix4().makeScale(1.25, 1.25, 1.25);
                      const transformMat = new THREE.Matrix4()
                        .makeTranslation(center.x, center.y, center.z)
                        .multiply(sclMat)
                        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
                      applyTransformationToSelectedBodies(transformMat);
                    }}
                    className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[10px] font-bold rounded border border-border-subtle cursor-pointer transition-colors"
                    title="Aumentar escala (+25%)"
                  >
                    × 1.25
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Actions (Confirm / Deselect, Reset, Delete) */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border-subtle/60 mt-1">
              <button
                onClick={() => setSelectedImportedBodyIds([])}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md active:scale-98"
                title="Confirmar posición y deseleccionar piezas (Enter)"
              >
                <span>✓ Confirmar Ubicación</span>
                <span className="text-[9.5px] bg-black/25 px-1.5 py-0.5 rounded font-mono font-normal opacity-85">Enter ↵</span>
              </button>

              <div className="flex gap-2">
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
                  className="flex-1 py-1 bg-surface hover:bg-zinc-700 text-text-muted hover:text-text-main text-[11px] font-semibold rounded transition-all cursor-pointer border border-border-subtle flex items-center justify-center gap-1"
                  title="Resetear posición y rotación de las piezas seleccionadas"
                >
                  <RefreshCw size={11} />
                  <span>Restablecer</span>
                </button>
                <button
                  onClick={() => {
                    const idsToDelete = selectedBodies.map(b => b.id);
                    // 1. Immediately remove meshes from ThreeJS scene and dispose VRAM
                    if (importedMeshGroupRef.current) {
                      const toRemove: THREE.Object3D[] = [];
                      importedMeshGroupRef.current.children.forEach(child => {
                        if (child instanceof THREE.Mesh && idsToDelete.includes(child.userData?.bodyId)) {
                          toRemove.push(child);
                          child.geometry.dispose();
                          if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                          } else {
                            child.material.dispose();
                          }
                        }
                      });
                      toRemove.forEach(mesh => importedMeshGroupRef.current?.remove(mesh));
                    }

                    // 2. Perform a single batch update to React state
                    if (onDeleteImportedBodiesRef.current) {
                      onDeleteImportedBodiesRef.current(idsToDelete);
                    } else if (onDeleteImportedBodyRef.current) {
                      idsToDelete.forEach(id => onDeleteImportedBodyRef.current?.(id));
                    }
                    setSelectedImportedBodyIds([]);
                  }}
                  className="flex-1 py-1 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white border border-red-500/40 text-[11px] font-semibold rounded transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                  title="Eliminar las piezas seleccionadas del modelo STEP"
                >
                  <Trash2 size={11} />
                  <span>{isSingle ? "Borrar Pieza" : `Borrar (${selectedBodies.length})`}</span>
                </button>
              </div>
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

      {/* Floating 3D Operation Glassmorphic Card (Only shown when configuring 3D op or region selected, never colliding with 2D properties) */}
      {(!isActuallySketchMode || showExtrudeCard) &&
        !showSolid &&
        activeSketch &&
        activeSketch.profiles &&
        activeSketch.profiles.length > 0 &&
        selectedProfileIds.length === 0 && (
        <div className="absolute top-4 right-4 z-20 bg-[#121214]/95 backdrop-blur-md border border-amber-500/40 p-4 rounded-xl shadow-[0_10px_35px_rgba(0,0,0,0.6)] w-72 pointer-events-auto flex flex-col gap-3 transition-all animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest leading-none flex items-center gap-1">
              <Sparkles size={11} className="text-amber-400" />
              <span>Operación en Progreso</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded font-mono font-bold border border-amber-500/20">
                {selectedShapeIndices.length} {selectedShapeIndices.length === 1 ? "Región" : "Regiones"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowExtrudeCard(false);
                  onCancelOperation?.();
                }}
                className="text-text-muted hover:text-white p-0.5 rounded transition-colors cursor-pointer"
                title="Cerrar panel de operación"
              >
                <X size={13} />
              </button>
            </div>
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
                  type="button"
                  onClick={() => {
                    setShowExtrudeCard(false);
                    onConfirmOperation?.();
                  }}
                  className="py-1.5 bg-emerald-600 hover:bg-emerald-500 text-text-main font-bold text-xs rounded transition-all duration-150 active:scale-95 shadow-[0_2px_8px_rgba(16,185,129,0.3)] cursor-pointer text-center"
                >
                  ✓ Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExtrudeCard(false);
                    onCancelOperation?.();
                  }}
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
    </div>
  );
}

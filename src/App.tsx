/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { readTheme, applyTheme } from './utils/theme';
import * as THREE from "three";
import { 
  Compass, 
  Settings2, 
  PenTool, 
  Box, 
  Workflow, 
  Share2, 
  HelpCircle,
  FileCode,
  Github,
  Zap,
  Sun,
  Moon,
  Scissors,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Cloud
} from "lucide-react";
import { SketchData, CADOperation, PlaneType, HistoryItem, PRESET_MATERIALS, MaterialStyle, Point2D, ImportedBody, BooleanOperation } from "./types";
import SketchCanvas from "./components/SketchCanvas";
import CADViewport from "./components/CADViewport";
import { getSolidRegions } from "./GeometryUtils";
import Sidebar from "./components/Sidebar";
import Timeline from "./components/Timeline";
import FirstPieceGuide from "./components/FirstPieceGuide";
import ShareModal from "./components/ShareModal";
import { exportToSTEP, exportToSTL, exportToOBJ } from "./ExporterSTEP";
import { worldStepRecipe } from "./utils/stepRecipe";
import { loadStepBufferToMeshes } from "./ImporterParser";
import { decodeCadBinary } from "./utils/cadBinary";

const calculateIntersectionSegments = (
  meshes: THREE.Mesh[],
  planeType: PlaneType,
  offset: number
): { p1: Point2D; p2: Point2D }[] => {
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

  meshes.forEach(mesh => {
    const geom = mesh.geometry;
    if (!geom) return;

    const positionAttr = geom.getAttribute("position");
    if (!positionAttr) return;

    // Fast bounding box check to immediately discard meshes that do not intersect the sketch plane
    if (!geom.boundingBox) geom.computeBoundingBox();
    if (geom.boundingBox) {
      const box = geom.boundingBox;
      if (planeType === "XY") {
        if (box.min.y > offset || box.max.y < offset) return;
      } else if (planeType === "XZ") {
        if (box.min.z > offset || box.max.z < offset) return;
      } else if (planeType === "YZ") {
        if (box.min.x > offset || box.max.x < offset) return;
      }
    }

    // Guard against gigantic imported STEP meshes (e.g. >100,000 vertices) causing OOM during slice intersection
    if (positionAttr.count > 100000) return;

    const indexAttr = geom.getIndex();
    const matrixWorld = mesh.matrixWorld;

    const getCoord = (v: THREE.Vector3): number => {
      if (planeType === "XY") return v.y;
      if (planeType === "XZ") return v.z;
      return v.x; // YZ
    };

    const projectTo2D = (v: THREE.Vector3): Point2D => {
      if (planeType === "XY") {
        return { x: v.x, y: -v.z };
      } else if (planeType === "XZ") {
        return { x: v.x, y: v.y };
      } else { // YZ
        return { x: v.z, y: v.y };
      }
    };

    const processTriangle = (idx0: number, idx1: number, idx2: number) => {
      const v0 = new THREE.Vector3().fromBufferAttribute(positionAttr, idx0).applyMatrix4(matrixWorld);
      const v1 = new THREE.Vector3().fromBufferAttribute(positionAttr, idx1).applyMatrix4(matrixWorld);
      const v2 = new THREE.Vector3().fromBufferAttribute(positionAttr, idx2).applyMatrix4(matrixWorld);

      const val0 = getCoord(v0);
      const val1 = getCoord(v1);
      const val2 = getCoord(v2);

      // Check intersection
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
        segments.push({ p1: pt1, p2: pt2 });
      }
    };

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i += 3) {
        processTriangle(indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2));
      }
    } else {
      for (let i = 0; i < positionAttr.count; i += 3) {
        processTriangle(i, i + 1, i + 2);
      }
    }
  });

  return segments;
};



// Global high-performance geometry cache for massive STEP assemblies (350MB+)
// This keeps heavy Float32Arrays outside of React's useState to eliminate V8 heap copying
export const bodyGeometryCache = new Map<string, {
  vertices: number[] | Float32Array;
  normals?: number[] | Float32Array;
  indices?: number[] | Uint32Array | Uint16Array;
}>();

export default function App() {
  // Theme state
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSketchId, setGuideSketchId] = useState<string | null>(null);

  // Project & Web Sharing state
  const [activeProjectName, setActiveProjectName] = useState<string>("Sketch_Solid_V1.step");
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "info" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const handleRestoreProjectData = async (project: any) => {
    isRestoringRef.current = true;
    try {
      // Rehydrate 3D imported models and pieces
      const importedModels: any[] = project.importedModels || [];
      const incomingBodies: ImportedBody[] = project.importedBodies || [];

      if (importedModels.length > 0 || incomingBodies.length > 0) {
        // When restoring an assembly project, clear default starter sketches so only the assembly is shown
        if (!project.sketches || Object.keys(project.sketches).length === 0 || 
            Object.values(project.sketches).every((s: any) => !s.profiles || s.profiles.length === 0)) {
          setSketches(prev => ({
            ...prev,
            "sketch-xy": { ...prev["sketch-xy"], profiles: [] },
            "sketch-xz": { ...prev["sketch-xz"], profiles: [] },
            "sketch-yz": { ...prev["sketch-yz"], profiles: [] }
          }));
          setOperations([]);
        } else {
          setSketches(project.sketches);
          if (project.operations) setOperations(project.operations);
        }
      } else {
        if (project.sketches && Object.keys(project.sketches).length > 0) {
          setSketches(project.sketches);
        }
        if (project.operations) {
          setOperations(project.operations);
        }
      }

      if (project.activeSketchId && project.sketches?.[project.activeSketchId]) {
        setActiveSketchId(project.activeSketchId);
      } else if (project.sketches && Object.keys(project.sketches).length > 0) {
        setActiveSketchId(Object.keys(project.sketches)[0]);
      }
      if (project.activePlane) {
        setActivePlane(project.activePlane);
      }
      if (project.material) {
        setMaterial(project.material);
      }
      if (project.name) {
        const formattedName = project.name.endsWith(".step") ? project.name : `${project.name}.step`;
        setActiveProjectName(formattedName);
      }
      if (project.theme) {
        setTheme(project.theme);
      }

      if (importedModels.length > 0) {
        showToast(`Downloading 3D models (${project.meta?.totalParts || incomingBodies.length} parts)...`, "info");

        for (const model of importedModels) {
          if (model.assetHash) {
            try {
              const res = await fetch(`/api/projects/assets/${model.assetHash}`);
              if (!res.ok) {
                throw new Error(`HTTP ${res.status} downloading 3D asset (${model.assetHash})`);
              }
              const buffer = await res.arrayBuffer();
              const decodedMeshes = decodeCadBinary(new Uint8Array(buffer));

              // Match and reconstruct bodies
              decodedMeshes.forEach((mesh, idx) => {
                const matchedBody = incomingBodies.find(
                  b => (b.sourceId === model.id && b.partIndex === idx) ||
                       (b.partIndex === idx && (!b.sourceId || b.sourceId === model.id)) ||
                       (b.id === `imported-${model.id}-${idx}`)
                ) || incomingBodies[idx];

                const bodyId = matchedBody ? matchedBody.id : `imported-${model.id}-${idx}`;

                // The CADBIN01 format stores the exact world-space geometry.
                bodyGeometryCache.set(bodyId, {
                  vertices: mesh.vertices,
                  normals: mesh.normals,
                  indices: mesh.indices
                });
              });
            } catch (err: any) {
              console.error("[ProjectRestore] Error fetching asset:", err);
              showToast(`Warning: Error loading 3D asset: ${err.message}`, "error");
            }
          }
        }

        // Apply updated imported bodies in state
        setImportedBodies(incomingBodies.map((b, idx) => ({
          ...b,
          id: b.id || `imported-body-${idx}`,
          visible: b.visible !== false,
          vertices: new Float32Array(0)
        })));

      } else if (incomingBodies.length > 0) {
        // Legacy project migration: check if vertices exist in payload
        let hasGeometry = false;
        incomingBodies.forEach(b => {
          if (b.vertices && (b.vertices as any).length > 0) {
            bodyGeometryCache.set(b.id, {
              vertices: b.vertices,
              normals: b.normals,
              indices: b.indices
            });
            hasGeometry = true;
          }
        });

        if (hasGeometry) {
          setImportedBodies(incomingBodies);
        } else {
          setImportedBodies([]);
          showToast("Notice: Legacy project without linked 3D asset. Sketches and operations were loaded.", "info");
        }
      } else {
        setImportedBodies([]);
      }

    } finally {
      isRestoringRef.current = false;
      setIsSketchMode(false);
      setSelectedShapeIndices([]);
      setActiveHistoryIndex(999);
    }
  };

  // Current CAD workspace plane
  const [activePlane, setActivePlane] = useState<PlaneType>("XY");
  const [activeSketchId, setActiveSketchId] = useState<string>("sketch-xy");

  // First-class explicit Sketch Mode state for professional CAD workflow
  const [isSketchMode, setIsSketchMode] = useState<boolean>(false);

  // --- Undo / Redo history stacks ---
  // Each entry stores a full snapshot of { sketches, operations } at a point in time.
  const undoStackRef = useRef<{ sketches: Record<string, SketchData>; operations: CADOperation[] }[]>([]);
  const redoStackRef = useRef<{ sketches: Record<string, SketchData>; operations: CADOperation[] }[]>([]);
  // Flag to suppress pushing to the undo stack while we are restoring state
  const isRestoringRef = useRef<boolean>(false);

  // Individual sketches (default base ones + custom face-aligned ones!)
  const [sketches, setSketches] = useState<Record<string, SketchData>>({
    "sketch-xy": {
      id: "sketch-xy",
      name: "XY Sketch (Top)",
      plane: "XY",
      profiles: [
        {
          id: "default-rect",
          type: "rectangle",
          isClosed: true,
          points: [
            { x: -35, y: -35 },
            { x: 35, y: -35 },
            { x: 35, y: 35 },
            { x: -35, y: 35 }
          ]
        },
        {
          id: "default-hole",
          type: "circle",
          center: { x: 0, y: 0 },
          radius: 16,
          isClosed: true,
          points: Array.from({ length: 32 }, (_, i) => {
            const angle = (i / 32) * Math.PI * 2;
            return {
              x: Math.cos(angle) * 16,
              y: Math.sin(angle) * 16
            };
          })
        }
      ],
      offset: 0
    },
    "sketch-xz": {
      id: "sketch-xz",
      name: "XZ Sketch (Front)",
      plane: "XZ",
      profiles: [],
      offset: 0
    },
    "sketch-yz": {
      id: "sketch-yz",
      name: "YZ Sketch (Right)",
      plane: "YZ",
      profiles: [],
      offset: 0
    }
  });

  const activeSketch = sketches[activeSketchId] || sketches["sketch-xy"] || Object.values(sketches)[0];

  // CAD 3D operations list (independent operation settings per plane)
  const [operations, setOperations] = useState<CADOperation[]>([
    {
      id: "op-sketch-xy",
      name: "Base Extrude",
      type: "extrude",
      sketchId: "sketch-xy",
      selectedShapeIndices: [],
      parameters: {
        height: 25,
        angle: 360,
        axis: "Y",
        booleanOp: "new-body",
        bevelType: "none",
        bevelSize: 1.0,
        taperScale: 1.0
      }
    }
  ]);

  // Pending interactive 3D operations state
  const [selectedShapeIndices, setSelectedShapeIndices] = useState<number[]>([]);
  const [pendingOpType, setPendingOpType] = useState<"extrude" | "revolve">("extrude");
  const [pendingHeight, setPendingHeight] = useState<number>(30);
  const [pendingAngle, setPendingAngle] = useState<number>(360);
  const [pendingRevolveAxisPoint1, setPendingRevolveAxisPoint1] = useState<Point2D | undefined>(undefined);
  const [pendingRevolveAxisPoint2, setPendingRevolveAxisPoint2] = useState<Point2D | undefined>(undefined);
  const [pendingBevelType, setPendingBevelType] = useState<"none" | "fillet" | "chamfer">("none");
  const [pendingBevelSize, setPendingBevelSize] = useState<number>(1.0);
  const [pendingTaperScale, setPendingTaperScale] = useState<number>(1.0);
  const [pendingBooleanOp, setPendingBooleanOp] = useState<BooleanOperation>("new-body");

  // Edge Selection for Filleting/Chamfering
  const [edgeSelectionMode, setEdgeSelectionMode] = useState<boolean>(false);
  const [selectedCorners, setSelectedCorners] = useState<{ profileId: string; vertexIndex: number }[]>([]);

  // Clear edge selection when changing active sketch
  useEffect(() => {
    setSelectedCorners([]);
    setEdgeSelectionMode(false);
  }, [activeSketchId]);

  const handleToggleCornerSelection = (profileId: string, vertexIndex: number) => {
    setSelectedCorners(prev => {
      const exists = prev.some(c => c.profileId === profileId && c.vertexIndex === vertexIndex);
      if (exists) {
        return prev.filter(c => !(c.profileId === profileId && c.vertexIndex === vertexIndex));
      } else {
        return [...prev, { profileId, vertexIndex }];
      }
    });
  };

  const handleUpdateSelectedCornersStyle = (type: "none" | "fillet" | "chamfer", size: number) => {
    if (selectedCorners.length === 0) return;

    // Group updates by profileId
    const updatesByProfile: Record<string, number[]> = {};
    selectedCorners.forEach(c => {
      if (!updatesByProfile[c.profileId]) {
        updatesByProfile[c.profileId] = [];
      }
      updatesByProfile[c.profileId].push(c.vertexIndex);
    });

    const updatedProfiles = activeSketch.profiles.map(p => {
      const indices = updatesByProfile[p.id];
      if (!indices) return p;

      const newStyles = { ...(p.cornerStyles || {}) };
      indices.forEach(idx => {
        if (type === "none") {
          delete newStyles[idx];
        } else {
          newStyles[idx] = { type, size };
        }
      });

      return {
        ...p,
        cornerStyles: newStyles
      };
    });

    handleUpdateActiveSketch({
      ...activeSketch,
      profiles: updatedProfiles
    });
  };

  const handleUpdateSketchOffset = (sketchId: string, newOffset: number) => {
    setSketches(prev => {
      const sketch = prev[sketchId];
      if (!sketch || sketch.offset === newOffset) return prev;
      
      if (!isRestoringRef.current) {
        undoStackRef.current.push({ sketches: prev, operations });
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        redoStackRef.current = [];
      }

      return {
        ...prev,
        [sketchId]: {
          ...sketch,
          offset: newOffset
        }
      };
    });
  };

  const handleClearSelectedCorners = () => {
    setSelectedCorners([]);
  };

  const handleShapeClick = (index: number) => {
    setSelectedShapeIndices(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
      } else {
        return [...prev, index];
      }
    });
  };

  const handleSelectAllShapes = () => {
    const regions = getSolidRegions(activeSketch);
    setSelectedShapeIndices(Array.from({ length: regions.length }, (_, i) => i));
  };

  const handleConfirmOperation = () => {
    const regions = getSolidRegions(activeSketch);
    const shapeIndices = selectedShapeIndices.length > 0 
      ? [...selectedShapeIndices] 
      : Array.from({ length: regions.length }, (_, i) => i);

    if (shapeIndices.length === 0) return;

    const existingOp = operations.find(o => o.sketchId === activeSketch.id);

    const newOp: CADOperation = {
      id: existingOp?.id || `op-${activeSketch.id}-${Date.now()}`,
      name: pendingOpType === "extrude" 
        ? (pendingBooleanOp === "cut" ? `Cut (${activeSketch.name})` : pendingBooleanOp === "join" ? `Join (${activeSketch.name})` : `Extrude (${activeSketch.name})`)
        : (pendingBooleanOp === "cut" ? `Revolve Cut (${activeSketch.name})` : pendingBooleanOp === "join" ? `Revolve Join (${activeSketch.name})` : `Revolve (${activeSketch.name})`),
      type: pendingOpType,
      sketchId: activeSketch.id,
      selectedShapeIndices: shapeIndices,
      parameters: {
        height: pendingHeight,
        angle: pendingAngle,
        axis: "Y",
        booleanOp: pendingBooleanOp,
        revolveAxisPoint1: existingOp?.parameters.revolveAxisPoint1 || pendingRevolveAxisPoint1,
        revolveAxisPoint2: existingOp?.parameters.revolveAxisPoint2 || pendingRevolveAxisPoint2,
        bevelType: pendingBevelType,
        bevelSize: pendingBevelSize,
        taperScale: pendingTaperScale
      }
    };

    // Push snapshot before applying the confirmed operation
    undoStackRef.current.push({ sketches, operations });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];

    setOperations(prev => {
      const filtered = prev.filter(o => o.sketchId !== activeSketch.id);
      return [...filtered, newOp];
    });

    setSelectedShapeIndices([]);
    setPendingRevolveAxisPoint1(undefined);
    setPendingRevolveAxisPoint2(undefined);
    // Automatically exit sketch mode so the user immediately sees the generated 3D solid!
    setIsSketchMode(false);
    // Force timeline pointer to the newly confirmed operation
    setActiveHistoryIndex(999);
  };

  const handleCancelOperation = () => {
    setSelectedShapeIndices([]);
    setPendingRevolveAxisPoint1(undefined);
    setPendingRevolveAxisPoint2(undefined);
    setPendingTaperScale(1.0);
  };

  // --- Global Undo (Ctrl+Z) / Redo (Ctrl+Y) keyboard handler ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is inside a text input / textarea to allow normal text editing
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const isUndo = e.ctrlKey && !e.shiftKey && e.key === "z";
      const isRedo = e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"));

      if (isUndo) {
        e.preventDefault();
        if (undoStackRef.current.length === 0) return;
        const snapshot = undoStackRef.current.pop()!;
        // Save current state to redo stack
        redoStackRef.current.push({ sketches, operations });
        // Restore snapshot without re-triggering undo
        isRestoringRef.current = true;
        setSketches(snapshot.sketches);
        setOperations(snapshot.operations);
        isRestoringRef.current = false;
      } else if (isRedo) {
        e.preventDefault();
        if (redoStackRef.current.length === 0) return;
        const snapshot = redoStackRef.current.pop()!;
        // Save current state to undo stack
        undoStackRef.current.push({ sketches, operations });
        // Restore snapshot without re-triggering undo
        isRestoringRef.current = true;
        setSketches(snapshot.sketches);
        setOperations(snapshot.operations);
        isRestoringRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sketches, operations]);

  // Compute history dynamically to guarantee timeline synchrony
  const currentHistory: HistoryItem[] = [];
  
  (Object.values(sketches) as SketchData[]).forEach(sketch => {
    if (sketch.profiles.length > 0 || sketch.id === activeSketchId) {
      currentHistory.push({
        id: `h-sketch-${sketch.id}`,
        type: "sketch",
        refId: sketch.id,
        name: sketch.name
      });
      
      const op = operations.find(o => o.sketchId === sketch.id);
      if (op) {
        currentHistory.push({
          id: `h-operation-${sketch.id}`,
          type: "operation",
          refId: op.id,
          name: op.type === "extrude" ? `Extrude (${sketch.name})` : `Revolve (${sketch.name})`
        });
      }
    }
  });

  if (currentHistory.length === 0) {
    currentHistory.push({
      id: `h-sketch-${activeSketch.id}`,
      type: "sketch",
      refId: activeSketch.id,
      name: activeSketch.name
    });
  }

  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number>(1);
  
  // Make sure index is always valid and default to the last item
  const safeHistoryIndex = currentHistory.length > 0 
    ? Math.min(activeHistoryIndex, currentHistory.length - 1)
    : 0;

  const lastSketchIdRef = useRef<string>(activeSketchId);
  const lastHistoryIndexRef = useRef<number>(0);
  const lastRegionsCountRef = useRef<number>(getSolidRegions(activeSketch).length);

  // Synchronize pending states when active history item, active sketch or operations change
  React.useEffect(() => {
    const regions = getSolidRegions(activeSketch);
    const currentRegionsCount = regions.length;

    const sketchIdChanged = activeSketchId !== lastSketchIdRef.current;
    const historyIndexChanged = safeHistoryIndex !== lastHistoryIndexRef.current;

    // Save refs for next run
    lastSketchIdRef.current = activeSketchId;
    lastHistoryIndexRef.current = safeHistoryIndex;

    const op = operations.find(o => o.sketchId === activeSketchId);

    if (sketchIdChanged || historyIndexChanged) {
      // Full reset/sync on sketch switch or timeline movement
      if (op) {
        if (op.selectedShapeIndices && op.selectedShapeIndices.length > 0) {
          setSelectedShapeIndices(op.selectedShapeIndices);
        } else {
          // If op exists but selectedShapeIndices is not set (e.g. default/imported), select all regions
          setSelectedShapeIndices(Array.from({ length: currentRegionsCount }, (_, i) => i));
        }
        setPendingOpType(op.type as "extrude" | "revolve");
        setPendingHeight(op.parameters.height);
        setPendingAngle(op.parameters.angle);
        setPendingRevolveAxisPoint1(op.parameters.revolveAxisPoint1);
        setPendingRevolveAxisPoint2(op.parameters.revolveAxisPoint2);
        setPendingBevelType(op.parameters.bevelType ?? "fillet");
        setPendingBevelSize(op.parameters.bevelSize ?? 0.8);
        setPendingTaperScale(op.parameters.taperScale ?? 1.0);
        setPendingBooleanOp(op.parameters.booleanOp ?? "new-body");
      } else {
        setSelectedShapeIndices([]);
        setPendingOpType("extrude");
        setPendingHeight(30);
        setPendingAngle(360);
        setPendingRevolveAxisPoint1(undefined);
        setPendingRevolveAxisPoint2(undefined);
        setPendingBevelType("none");
        setPendingBevelSize(1.0);
        setPendingTaperScale(1.0);
        setPendingBooleanOp("new-body");
      }
      lastRegionsCountRef.current = currentRegionsCount;
    } else {
      // The sketch contents changed (profiles added/removed) but we are on the same sketch/history step
      if (currentRegionsCount !== lastRegionsCountRef.current) {
        if (currentRegionsCount > lastRegionsCountRef.current) {
          // Regions count increased (e.g. drawn, mirrored, patterned)
          // Auto-select the newly added region indices
          const newIndices: number[] = [];
          for (let i = lastRegionsCountRef.current; i < currentRegionsCount; i++) {
            newIndices.push(i);
          }
          setSelectedShapeIndices(prev => {
            // Keep existing selections, append new ones, and make sure we don't have duplicates
            const updated = [...prev];
            newIndices.forEach(idx => {
              if (!updated.includes(idx)) {
                updated.push(idx);
              }
            });
            return updated;
          });
        } else {
          // Regions count decreased (e.g. deleted)
          // Filter out indices that are now out of bounds
          setSelectedShapeIndices(prev => prev.filter(idx => idx < currentRegionsCount));
        }
        lastRegionsCountRef.current = currentRegionsCount;
      }
    }
  }, [activeSketchId, safeHistoryIndex, operations, activeSketch]);

  // Synchronize existing operation's selectedShapeIndices with current selectedShapeIndices
  React.useEffect(() => {
    if (selectedShapeIndices.length === 0) return;
    const op = operations.find(o => o.sketchId === activeSketchId);
    if (op) {
      const same = op.selectedShapeIndices &&
                   op.selectedShapeIndices.length === selectedShapeIndices.length &&
                   op.selectedShapeIndices.every((val, index) => val === selectedShapeIndices[index]);
      if (!same) {
        setOperations(prevOps => prevOps.map(o => {
          if (o.sketchId === activeSketchId) {
            return {
              ...o,
              selectedShapeIndices: [...selectedShapeIndices]
            };
          }
          return o;
        }));
      }
    }
  }, [selectedShapeIndices, activeSketchId, operations]);

  // State to hold raycasted selected face/plane info
  const [selectedFaceInfo, setSelectedFaceInfo] = useState<{
    plane: PlaneType;
    offset: number;
    faceNormal: number[];
    point: number[];
  } | null>(null);

  // Imported 3D models state
  const [importedBodies, setImportedBodies] = useState<ImportedBody[]>([]);

  // Solid boolean operations state
  const [activeSolidOp, setActiveSolidOp] = useState<"none" | "join" | "cut" | "intersect">("none");
  const [selectedTargetSolidId, setSelectedTargetSolidId] = useState<string | null>(null);
  const [selectedToolSolidId, setSelectedToolSolidId] = useState<string | null>(null);

  const handleSolidSelection = (solidId: string) => {
    if (activeSolidOp === "none") return;
    if (!selectedTargetSolidId) {
      setSelectedTargetSolidId(solidId);
    } else if (solidId !== selectedTargetSolidId && !selectedToolSolidId) {
      setSelectedToolSolidId(solidId);
    }
  };

  const handleConfirmSolidOp = () => {
    if (!selectedTargetSolidId || !selectedToolSolidId || activeSolidOp === "none") return;
    
    const newOp: CADOperation = {
      id: `op-bool-${Date.now()}`,
      name: `Boolean Op (${activeSolidOp === "join" ? "Union" : activeSolidOp === "cut" ? "Subtract" : "Intersect"})`,
      type: "boolean_solid",
      sketchId: "none",
      parameters: {
        height: 0,
        angle: 0,
        axis: "X",
        booleanOp: "new-body",
        targetSolidId: selectedTargetSolidId,
        toolSolidId: selectedToolSolidId,
        booleanSolidOp: activeSolidOp
      }
    };
    
    const newOps = [...operations];
    newOps.splice(safeHistoryIndex, 0, newOp);

    if (!isRestoringRef.current) {
      undoStackRef.current.push({ sketches, operations: newOps });
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      redoStackRef.current = [];
    }

    setOperations(newOps);
    setActiveHistoryIndex(safeHistoryIndex + 1);
    
    // Reset state
    setActiveSolidOp("none");
    setSelectedTargetSolidId(null);
    setSelectedToolSolidId(null);
  };
  
  const handleCancelSolidOp = () => {
    setActiveSolidOp("none");
    setSelectedTargetSolidId(null);
    setSelectedToolSolidId(null);
  };

  const handleImportBody = (
    name: string, 
    vertices: number[] | Float32Array,
    normals?: number[] | Float32Array,
    indices?: number[] | Uint32Array | Uint16Array,
    color?: [number, number, number]
  ) => {
    const id = `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    bodyGeometryCache.set(id, { vertices, normals, indices });

    const newBody: ImportedBody = {
      id,
      name,
      vertices: new Float32Array(0),
      color
    };

    setSketches(prev => ({
      ...prev,
      "sketch-xy": { ...prev["sketch-xy"], profiles: [] },
      "sketch-xz": { ...prev["sketch-xz"], profiles: [] },
      "sketch-yz": { ...prev["sketch-yz"], profiles: [] }
    }));
    setOperations([]);
    setSelectedShapeIndices([]);

    setImportedBodies(prev => [...prev, newBody]);
  };

  const handleImportBodies = (
    bodies: Array<{
      name: string;
      vertices: number[] | Float32Array;
      normals?: number[] | Float32Array;
      indices?: number[] | Uint32Array | Uint16Array;
      color?: [number, number, number];
    }>
  ) => {
    const newBodies: ImportedBody[] = bodies.map(b => {
      const id = `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      bodyGeometryCache.set(id, { vertices: b.vertices, normals: b.normals, indices: b.indices });
      return {
        id,
        name: b.name,
        vertices: new Float32Array(0),
        color: b.color
      };
    });

    // Clear initial template sketch and 3D preview so user can work cleanly with their STEP file
    setSketches(prev => ({
      ...prev,
      "sketch-xy": { ...prev["sketch-xy"], profiles: [] },
      "sketch-xz": { ...prev["sketch-xz"], profiles: [] },
      "sketch-yz": { ...prev["sketch-yz"], profiles: [] }
    }));
    setOperations([]);
    setSelectedShapeIndices([]);

    setImportedBodies(prev => [...prev, ...newBodies]);
  };

  const handleDeleteImportedBody = (id: string) => {
    bodyGeometryCache.delete(id);
    setImportedBodies(prev => prev.filter(body => body.id !== id));
  };

  const handleUpdateImportedBody = (updatedBody: ImportedBody) => {
    setImportedBodies(prev => prev.map(b => b.id === updatedBody.id ? updatedBody : b));
  };

  const handleUpdateImportedBodies = (updatedBodies: ImportedBody[]) => {
    const updateMap = new Map(updatedBodies.map(b => [b.id, b]));
    setImportedBodies(prev => prev.map(b => updateMap.get(b.id) || b));
  };

  // Automated import handler for parts received from STEP Splitter Pro
  const [autoImportStatus, setAutoImportStatus] = useState<{
    active: boolean;
    message: string;
    percent: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project') || urlParams.get('share');
    if (projectId) {
      (async () => {
        try {
          showToast(`Loading project "${projectId}" from cloud...`, "info");
          const res = await fetch(`/api/projects/${projectId}`);
          if (res.ok) {
            const json = await res.json();
            if (json && json.project) {
              await handleRestoreProjectData(json.project);
              showToast(`✓ Project "${json.project.name || projectId}" loaded and synchronized`, "success");
            } else {
              showToast(`Project with ID "${projectId}" contains invalid data.`, "error");
            }
          } else {
            const errData = await res.json().catch(() => null);
            const errorMsg = errData?.error || `No project found with ID "${projectId}".`;
            showToast(`Error opening project: ${errorMsg}`, "error");
          }
        } catch (e: any) {
          showToast(`Network error retrieving project: ${e.message}`, "error");
        }
      })();
    }

    const importPath = urlParams.get('importPath') || localStorage.getItem('cad_pending_import_path');
    const importPathsJson = urlParams.get('importPaths') || localStorage.getItem('cad_pending_import_paths');

    if (importPath || importPathsJson) {
      if (window.location.search) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      localStorage.removeItem('cad_pending_import_path');
      localStorage.removeItem('cad_pending_import_name');
      localStorage.removeItem('cad_pending_import_paths');

      const partsQueue: { path: string; name: string }[] = [];
      if (importPathsJson) {
        try {
          const parsed = JSON.parse(importPathsJson);
          if (Array.isArray(parsed)) {
            partsQueue.push(...parsed);
          }
        } catch (e) {}
      }
      if (partsQueue.length === 0 && importPath) {
        const name = urlParams.get('name') || importPath.split(/[/\\]/).pop() || 'STEP_Part';
        partsQueue.push({ path: importPath, name });
      }

      if (partsQueue.length > 0) {
        (async () => {
          let totalImported = 0;
          for (let i = 0; i < partsQueue.length; i++) {
            const item = partsQueue[i];
            setAutoImportStatus({
              active: true,
              message: `[${i + 1}/${partsQueue.length}] Downloading '${item.name}'...`,
              percent: Math.round((i / partsQueue.length) * 100)
            });

            try {
              const resp = await fetch(`/api/step-split/download?path=${encodeURIComponent(item.path)}`);
              if (!resp.ok) {
                throw new Error(`Error ${resp.status} downloading file`);
              }
              const buf = await resp.arrayBuffer();

              setAutoImportStatus({
                active: true,
                message: `[${i + 1}/${partsQueue.length}] Extracting solids from '${item.name}' (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)...`,
                percent: Math.round(((i + 0.5) / partsQueue.length) * 100)
              });

              const meshes = await loadStepBufferToMeshes(buf, item.name, (stage, pct) => {
                setAutoImportStatus({
                  active: true,
                  message: `[${i + 1}/${partsQueue.length}] ${stage}`,
                  percent: Math.min(99, Math.round(((i + pct / 100) / partsQueue.length) * 100))
                });
              });

              if (meshes.length > 0) {
                handleImportBodies(meshes);
                totalImported += meshes.length;
              }
            } catch (err: any) {
              console.error(`Error importing ${item.name}:`, err);
              setAutoImportStatus({
                active: false,
                message: `Failed to import '${item.name}': ${err.message}`,
                percent: 0,
                error: err.message
              });
              setTimeout(() => setAutoImportStatus(null), 7000);
              return;
            }
          }

          setAutoImportStatus({
            active: false,
            message: `Load successful! Added ${totalImported} solids to the CAD scene.`,
            percent: 100
          });
          setTimeout(() => setAutoImportStatus(null), 4000);
        })();
      }
    }
  }, []);

  const handleImportSketches = (newSketches: SketchData[], customOps?: CADOperation[]) => {
    setSketches(prev => {
      const updated = { ...prev };
      newSketches.forEach(s => {
        updated[s.id] = s;
      });
      return updated;
    });

    if (customOps && customOps.length > 0) {
      setOperations(prev => [...prev, ...customOps]);
    } else {
      const newOps: CADOperation[] = newSketches.map(s => ({
        id: `op-${s.id}`,
        name: `Solid Extrude (${s.name})`,
        type: "extrude",
        sketchId: s.id,
        parameters: {
          height: 20,
          angle: 360,
          axis: "Y",
          booleanOp: "new-body",
          bevelType: "none",
          bevelSize: 0.8,
          taperScale: 1.0
        }
      }));
      setOperations(prev => [...prev, ...newOps]);
    }

    if (newSketches.length > 0) {
      setActiveSketchId(newSketches[0].id);
      setActivePlane(newSketches[0].plane);
    }
  };


  // Active workspace material parameters
  const [material, setMaterial] = useState<MaterialStyle>({...PRESET_MATERIALS[0]});
  const [showEdgesOnly, setShowEdgesOnly] = useState<boolean>(false);

  // Buffer state holding the actively created WebGL ThreeJS meshes for exporters click
  const activeThreeMeshesRef = useRef<THREE.Mesh[]>([]);

  const [intersectionSegments, setIntersectionSegments] = useState<{ p1: Point2D; p2: Point2D }[]>([]);

  const handleMeshCreated = (meshes: THREE.Mesh[]) => {
    activeThreeMeshesRef.current = meshes;

    // Filter previous solid meshes (exclude heavy imported bodies to prevent OOM)
    const prevMeshes = meshes.filter(mesh => {
      if (mesh.userData.type === "imported") return false;
      if (mesh.userData.type === "solid") {
        const meshSketchId = mesh.userData.sketchId;
        if (meshSketchId === activeSketch.id) {
          return false;
        }
        const activeSketchIndex = currentHistory.findIndex(h => h.type === "sketch" && h.refId === activeSketch.id);
        const meshSketchIndex = currentHistory.findIndex(h => h.type === "sketch" && h.refId === meshSketchId);
        if (activeSketchIndex === -1) {
          return meshSketchIndex !== -1;
        }
        if (meshSketchIndex !== -1) {
          return meshSketchIndex < activeSketchIndex;
        }
      }
      return false;
    });

    const segments = calculateIntersectionSegments(prevMeshes, activeSketch.plane, activeSketch.offset || 0);
    setIntersectionSegments(segments);
  };

  // Re-calculate plane slice intersections if active sketch details change
  React.useEffect(() => {
    const meshes = activeThreeMeshesRef.current;
    if (!meshes || meshes.length === 0) {
      setIntersectionSegments([]);
      return;
    }

    const prevMeshes = meshes.filter(mesh => {
      if (mesh.userData.type === "imported") return false;
      if (mesh.userData.type === "solid") {
        const meshSketchId = mesh.userData.sketchId;
        if (meshSketchId === activeSketch.id) {
          return false;
        }
        const activeSketchIndex = currentHistory.findIndex(h => h.type === "sketch" && h.refId === activeSketch.id);
        const meshSketchIndex = currentHistory.findIndex(h => h.type === "sketch" && h.refId === meshSketchId);
        if (activeSketchIndex === -1) {
          return meshSketchIndex !== -1;
        }
        if (meshSketchIndex !== -1) {
          return meshSketchIndex < activeSketchIndex;
        }
      }
      return false;
    });

    const segments = calculateIntersectionSegments(prevMeshes, activeSketch.plane, activeSketch.offset || 0);
    setIntersectionSegments(segments);
  }, [activeSketchId, activeSketch.plane, activeSketch.offset, sketches, operations]);

  // Revolve axis selection state
  // null if not selecting, or: { sketchId: string, step: 1 | 2, p1?: Point2D }
  const [axisSelection, setAxisSelection] = useState<{
    sketchId: string;
    step: 1 | 2;
    p1?: Point2D;
  } | null>(null);

  const handleStartAxisSelection = () => {
    setAxisSelection({
      sketchId: activeSketchId,
      step: 1
    });
  };

  const handleResetToDefaultAxis = () => {
    const isEditing = currentHistory[safeHistoryIndex]?.type === "sketch";
    const activeOp = operations.find(o => o.sketchId === activeSketchId);
    if (!isEditing && activeOp) {
      const updated = operations.map(op => {
        if (op.sketchId === activeSketchId) {
          return {
            ...op,
            parameters: {
              ...op.parameters,
              revolveAxisPoint1: undefined,
              revolveAxisPoint2: undefined
            }
          };
        }
        return op;
      });
      setOperations(updated);
    } else {
      setPendingRevolveAxisPoint1(undefined);
      setPendingRevolveAxisPoint2(undefined);
    }
  };

  const handleSelectAxisPoint = (p: Point2D) => {
    if (!axisSelection) return;
    if (axisSelection.step === 1) {
      setAxisSelection({
        ...axisSelection,
        step: 2,
        p1: p
      });
    } else {
      const p1 = axisSelection.p1;
      const p2 = p;
      if (p1 && p2) {
        if (p1.x === p2.x && p1.y === p2.y) {
          return;
        }
        const isEditing = currentHistory[safeHistoryIndex]?.type === "sketch";
        const activeOp = operations.find(o => o.sketchId === axisSelection.sketchId);
        if (!isEditing && activeOp) {
          const updated = operations.map(op => {
            if (op.sketchId === axisSelection.sketchId) {
              return {
                ...op,
                parameters: {
                  ...op.parameters,
                  revolveAxisPoint1: p1,
                  revolveAxisPoint2: p2
                }
              };
            }
            return op;
          });
          setOperations(updated);
        } else {
          setPendingRevolveAxisPoint1(p1);
          setPendingRevolveAxisPoint2(p2);
        }
      }
      setAxisSelection(null);
    }
  };

  // Create a new customized sketch, aligned to a specific plane and offset (height)
  const handleAddNewSketchOnFace = (plane: PlaneType, offset: number, name?: string, faceNormal?: [number, number, number], origin?: [number, number, number]) => {
    const newId = `sketch-${Date.now()}`;
    const newSketchName = name || `Part ${plane} (${offset >= 0 ? "+" : ""}${offset}mm)`;
    
    const newSketch: SketchData = {
      id: newId,
      name: newSketchName,
      plane: plane,
      profiles: [],
      offset: offset,
      faceNormal: faceNormal,
      origin: origin
    };

    setSketches(prev => ({
      ...prev,
      [newId]: newSketch
    }));

    setActiveSketchId(newId);
    setActivePlane(plane);
    setSelectedFaceInfo(null); // Clear selected indicator after creation
    
    // Auto point history selection to newly created sketch and enter Sketch Mode immediately
    setActiveHistoryIndex(999);
    setIsSketchMode(true);
  };

  const handleEnterSketchMode = (sketchId?: string) => {
    if (sketchId && sketches[sketchId]) {
      setActiveSketchId(sketchId);
      setActivePlane(sketches[sketchId].plane);
    }
    setSelectedShapeIndices([]);
    setIsSketchMode(true);
  };

  const handleExitSketchMode = () => {
    setIsSketchMode(false);
    // Auto-select solid regions for extrusion if any exist
    const regions = getSolidRegions(activeSketch);
    if (regions.length > 0) {
      setSelectedShapeIndices(Array.from({ length: regions.length }, (_, i) => i));
    }
  };

  // Switch workspace layout plane coordinate orientation
  const handlePlaneChange = (plane: PlaneType) => {
    setActivePlane(plane);
    const baseSketches: Record<PlaneType, string> = { XY: "sketch-xy", XZ: "sketch-xz", YZ: "sketch-yz" };
    const defaultId = baseSketches[plane];
    if (sketches[defaultId]) {
      setActiveSketchId(defaultId);
    } else {
      const matched = (Object.values(sketches) as SketchData[]).find(s => s.plane === plane);
      if (matched) {
        setActiveSketchId(matched.id);
      }
    }
  };

  const handleUpdateActiveSketch = (newSketch: SketchData) => {
    setSketches(prev => {
      // Avoid pushing to the stack if nothing has actually changed
      if (JSON.stringify(prev[activeSketchId]) === JSON.stringify(newSketch)) {
        return prev;
      }
      
      // Push snapshot to undo stack before applying the change (but not when restoring)
      if (!isRestoringRef.current) {
        undoStackRef.current.push({ sketches: prev, operations });
        // Cap stack at 100 steps to avoid unbounded memory growth
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        // Any new change clears the redo stack
        redoStackRef.current = [];
      }
      return { ...prev, [activeSketchId]: newSketch };
    });
  };

  const handleUpdateOperations = (newOps: CADOperation[]) => {
    if (JSON.stringify(operations) === JSON.stringify(newOps)) return;
    
    if (!isRestoringRef.current) {
      undoStackRef.current.push({ sketches, operations });
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      redoStackRef.current = [];
    }
    setOperations(newOps);
  };

  // Timeline delete operation item callback
  const handleDeleteHistoryItem = (id: string) => {
    if (id.includes("sketch")) {
      handleUpdateActiveSketch({
        ...activeSketch,
        profiles: []
      });
    } else {
      setOperations(prev => prev.filter(op => op.sketchId !== activeSketch.id));
    }
    setActiveHistoryIndex(0);
  };

  const handleDeleteSketch = (sketchId: string) => {
    if (["sketch-xy", "sketch-xz", "sketch-yz"].includes(sketchId)) {
      setSketches(prev => ({
        ...prev,
        [sketchId]: {
          ...prev[sketchId],
          profiles: []
        }
      }));
    } else {
      setSketches(prev => {
        const copy = { ...prev };
        delete copy[sketchId];
        return copy;
      });
      setOperations(prev => prev.filter(op => op.sketchId !== sketchId));
      
      if (activeSketchId === sketchId) {
        setActiveSketchId("sketch-xy");
        setActivePlane("XY");
      }
    }
  };

  // Trigger File Download in Browser Sandbox with guaranteed extensions and delayed revocation
  const downloadFile = (fileName: string, content: string, mimeType: string) => {
    try {
      // Use File API so the file object intrinsically contains the filename metadata
      const file = new File([content], fileName, { type: mimeType });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.setAttribute("download", fileName);
      link.rel = "noopener noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      
      // Trigger download
      link.click();
      
      // CRITICAL: Do NOT revoke URL immediately. Chrome/Edge needs time to complete the download handshake.
      setTimeout(() => {
        try {
          if (link.parentNode) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        } catch (e) {}
      }, 60000);
    } catch (err) {
      // Fallback for browsers that don't support new File() constructor
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.setAttribute("download", fileName);
      link.rel = "noopener noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        try {
          if (link.parentNode) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        } catch (e) {}
      }, 60000);
    }
  };

  // Save Project
  const handleSaveProject = () => {
    const projectData = {
      version: "1.0",
      sketches,
      operations,
      importedBodies,
      activePlane,
      activeSketchId,
      material
    };
    const jsonStr = JSON.stringify(projectData, null, 2);
    downloadFile("proyecto.cadproj", jsonStr, "application/json;charset=utf-8");
  };

  // Load Project
  const handleLoadProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.sketches) setSketches(data.sketches);
        if (data.operations) setOperations(data.operations);
        if (data.importedBodies) setImportedBodies(data.importedBodies);
        if (data.activePlane) setActivePlane(data.activePlane);
        if (data.activeSketchId) setActiveSketchId(data.activeSketchId);
        if (data.material) setMaterial(data.material);
        
        // Reset interactive state
        setActiveHistoryIndex(Math.max(0, (data.operations?.length || 0) - 1));
        setSelectedShapeIndices([]);
        setPendingBooleanOp("new-body");
      } catch (err) {
        alert("Error loading project: invalid or corrupted file.");
      }
    };
    reader.readAsText(file);
    event.target.value = ""; // Reset input so same file can be reloaded
  };

  // Prefer native CAD construction data; retain mesh export for unsupported parts.
  const handleExportSTEP = async () => {
    const bodies = activeThreeMeshesRef.current.map((mesh, index) => ({
      name: mesh.name || `Part_${index + 1}`,
      mesh
    }));

    if (bodies.length === 0) {
      showToast("No active 3D geometry found in scene to export.", "error");
      return;
    }

    const exportFilename = activeProjectName.endsWith(".step") ? activeProjectName : `${activeProjectName}.step`;
    showToast(`Generating STEP file "${exportFilename}" with OpenCASCADE...`, "info");

    // Attempt high-fidelity OpenCASCADE 64-bit solid export via server
    try {
      const partsPayload = bodies.map(b => {
        b.mesh.updateWorldMatrix(true, false);
        const geom = b.mesh.geometry;
        const posAttr = geom.getAttribute("position");
        const idxAttr = geom.getIndex();
        const mat = b.mesh.matrixWorld;

        const verts: number[] = [];
        const v = new THREE.Vector3();
        if (posAttr) {
          for (let i = 0; i < posAttr.count; i++) {
            v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(mat);
            verts.push(v.x, v.y, v.z);
          }
        }

        const indices: number[] = [];
        if (idxAttr) {
          for (let i = 0; i < idxAttr.count; i++) {
            indices.push(idxAttr.getX(i));
          }
        }

        let color = [0.72, 0.76, 0.82];
        if (b.mesh.userData?.baseColor) {
          const bc = b.mesh.userData.baseColor;
          if (Array.isArray(bc) && bc.length >= 3) color = [bc[0], bc[1], bc[2]];
          else if (typeof bc === "string") {
            const c = new THREE.Color(bc);
            color = [c.r, c.g, c.b];
          }
        } else if (b.mesh.material) {
          const m = Array.isArray(b.mesh.material) ? b.mesh.material[0] : b.mesh.material;
          if (m && "color" in m && (m as any).color) {
            const c = (m as any).color;
            color = [c.r, c.g, c.b];
          }
        }

        return {
          name: b.name,
          color,
          recipe: worldStepRecipe(b.mesh),
          vertices: verts,
          indices: indices.length > 0 ? indices : undefined
        };
      });

      const resp = await fetch("/api/export-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: exportFilename, parts: partsPayload })
      });

      if (resp.ok) {
        const stepText = await resp.text();
        if (stepText && stepText.length > 100) {
          downloadFile(exportFilename, stepText, "application/step;charset=utf-8");
          const meshParts = Number(resp.headers.get("X-STEP-Mesh-Parts") || 0);
          showToast(meshParts > 0
            ? `STEP downloaded. ${meshParts} part(s) derived from meshes: planar faces merged, curves may retain facets.`
            : `✓ STEP file "${exportFilename}" downloaded with CAD surfaces.`, meshParts > 0 ? "info" : "success");
          return;
        }
      }
    } catch (e: any) {
      console.warn("Server OpenCASCADE solid export failed, falling back to local exporter:", e);
    }

    // Client-side fallback with topological shared vertices and edges
    try {
      // The mesh is authoritative here. Rebuilding from sketches alone could
      // silently omit later cuts, joins, transforms or the active history state.
      const stepContent = exportToSTEP(bodies);
      if (!stepContent || stepContent.length < 100) {
        throw new Error("Generated STEP file contains no valid entities.");
      }
      downloadFile(exportFilename, stepContent, "application/step;charset=utf-8");
      showToast(`STEP downloaded in mesh mode: CAD engine unavailable, exported with triangulated faces.`, "info");
    } catch (fallbackErr: any) {
      showToast(`Error generating STEP file: ${fallbackErr.message}`, "error");
    }
  };

  // Export STL Trigger
  const handleExportSTL = () => {
    const bodies = activeThreeMeshesRef.current.map((mesh, index) => ({
      name: mesh.name || `Part_${index + 1}`,
      mesh
    }));

    if (bodies.length === 0) {
      alert("No geometry found to export.");
      return;
    }

    const stlContent = exportToSTL(bodies);
    downloadFile("cad_model_exported.stl", stlContent, "model/stl;charset=utf-8");
  };

  // Export OBJ Trigger
  const handleExportOBJ = () => {
    const bodies = activeThreeMeshesRef.current.map((mesh, index) => ({
      name: mesh.name || `Part_${index + 1}`,
      mesh
    }));

    if (bodies.length === 0) {
      alert("No geometry found to export.");
      return;
    }

    const objContent = exportToOBJ(bodies);
    downloadFile("cad_model_exported.obj", objContent, "model/obj;charset=utf-8");
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-app text-text-main overflow-hidden select-none font-sans">
      
      <header className="editor-header">
        <div className="editor-brand"><span className="editor-logo">V</span><strong>VOXEL3D <span className="text-text-muted font-normal">CAD</span></strong></div>
        <span className="editor-project" title={activeProjectName}>{activeProjectName}</span>
        <nav className="editor-actions" aria-label="Project actions">
          <button className="editor-button" onClick={() => setGuideOpen(v => !v)} aria-expanded={guideOpen} aria-controls="first-piece-guide"><HelpCircle size={16} /> First piece</button>
          <button className="editor-button" onClick={handleSaveProject}>Save file</button>
          <button className="editor-button editor-button-primary" onClick={() => setIsShareModalOpen(true)}><Cloud size={16} /> Share link</button>
          <details className="editor-more">
            <summary className="editor-button">More options</summary>
            <div className="editor-menu">
              <span className="text-text-muted text-sm">Working units: mm</span>
              <button className="editor-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {theme === 'dark' ? 'Light' : 'Dark'} theme</button>
              <a className="editor-button" href="/splitter.html" target="_blank" rel="noopener noreferrer">Split STEP files ↗</a>
              <a className="editor-button" href="/servicios" target="_blank" rel="noopener noreferrer">Services & Support ↗</a>
            </div>
          </details>
        </nav>
      </header>
      {guideOpen && <FirstPieceGuide
        hasSketch={!!guideSketchId && !!sketches[guideSketchId]}
        hasSolid={!!guideSketchId && operations.some(op => op.sketchId === guideSketchId)}
        onClose={() => setGuideOpen(false)}
        onCreateSketch={() => {
          const id = `guide-${Date.now()}`;
          undoStackRef.current.push({ sketches, operations });
          redoStackRef.current = [];
          setSketches(prev => ({ ...prev, [id]: { id, name: 'My first part · 40 × 30 mm', plane: 'XY', offset: 0, profiles: [{ id: `${id}-rect`, type: 'rectangle', isClosed: true, points: [{ x: 65, y: -15 }, { x: 105, y: -15 }, { x: 105, y: 15 }, { x: 65, y: 15 }] }] } }));
          setGuideSketchId(id);
          setActiveSketchId(id);
          setActivePlane('XY');
          setIsSketchMode(true);
          setSelectedShapeIndices([]);
          setActiveHistoryIndex(999);
        }}
        onExtrude={() => {
          if (!guideSketchId || !sketches[guideSketchId]) return;
          undoStackRef.current.push({ sketches, operations });
          redoStackRef.current = [];
          setOperations(prev => [...prev, { id: `op-${guideSketchId}`, name: 'First part · height 10 mm', type: 'extrude', sketchId: guideSketchId, selectedShapeIndices: [], parameters: { height: 10, angle: 360, axis: 'Y', booleanOp: 'new-body', bevelType: 'none', taperScale: 1 } }]);
          setActiveSketchId(guideSketchId);
          setActivePlane('XY');
          setIsSketchMode(false);
          setActiveHistoryIndex(999);
        }}
        onSave={handleSaveProject}
      />}

      {/* Main interactive splits screen */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Control Sidebar */}
        <Sidebar
          activePlane={activePlane}
          onChangePlane={handlePlaneChange}
          sketches={sketches}
          activeSketch={activeSketch}
          onUpdateActiveSketch={handleUpdateActiveSketch}
          onUpdateSketchOffset={handleUpdateSketchOffset}
          onSelectSketch={setActiveSketchId}
          onDeleteSketch={handleDeleteSketch}
          onAddNewSketch={() => {
            const offsetStr = window.prompt(`Enter offset (distance in mm) for new ${activePlane} plane:`, "0");
            if (offsetStr === null) return;
            const offset = parseFloat(offsetStr) || 0;
            handleAddNewSketchOnFace(activePlane, offset);
          }}
          operations={operations}
          onUpdateOperations={handleUpdateOperations}
          onSaveProject={handleSaveProject}
          onLoadProject={handleLoadProject}
          onExportSTEP={handleExportSTEP}
          onExportSTL={handleExportSTL}
          onExportOBJ={handleExportOBJ}
          isSelectingAxis={axisSelection !== null}
          onStartAxisSelection={handleStartAxisSelection}
          onResetToDefaultAxis={handleResetToDefaultAxis}
          importedBodies={importedBodies}
          onImportBody={handleImportBody}
          onImportBodies={handleImportBodies}
          onDeleteImportedBody={handleDeleteImportedBody}
          onUpdateImportedBody={handleUpdateImportedBody}
          onUpdateImportedBodies={handleUpdateImportedBodies}
          onImportSketches={handleImportSketches}
          selectedShapeIndices={selectedShapeIndices}
          pendingOpType={pendingOpType}
          pendingHeight={pendingHeight}
          pendingAngle={pendingAngle}
          onConfirmOperation={handleConfirmOperation}
          onCancelOperation={handleCancelOperation}
          onChangePendingOpType={setPendingOpType}
          onChangePendingHeight={setPendingHeight}
          onChangePendingAngle={setPendingAngle}
          pendingRevolveAxisPoint1={pendingRevolveAxisPoint1}
          pendingRevolveAxisPoint2={pendingRevolveAxisPoint2}
          onChangePendingRevolveAxisPoint1={setPendingRevolveAxisPoint1}
          onChangePendingRevolveAxisPoint2={setPendingRevolveAxisPoint2}
          pendingBevelType={pendingBevelType}
          pendingBevelSize={pendingBevelSize}
          onChangePendingBevelType={setPendingBevelType}
          onChangePendingBevelSize={setPendingBevelSize}
          pendingBooleanOp={pendingBooleanOp}
          onChangePendingBooleanOp={setPendingBooleanOp}
          showSolid={!isSketchMode && currentHistory[safeHistoryIndex]?.type === "operation"}
          onSelectAllShapes={handleSelectAllShapes}
          edgeSelectionMode={edgeSelectionMode}
          onChangeEdgeSelectionMode={setEdgeSelectionMode}
          selectedCorners={selectedCorners}
          onUpdateSelectedCornersStyle={handleUpdateSelectedCornersStyle}
          onClearSelectedCorners={handleClearSelectedCorners}
          isSketchMode={isSketchMode}
          onEditSketch={handleEnterSketchMode}
        />

        {/* Workspace Center Content */}
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden bg-app relative">
          {/* Face Selection Slider alert overlay! */}
          {selectedFaceInfo && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-[#121214]/95 backdrop-blur-md border border-blue-500/50 p-4 rounded-lg shadow-2xl z-40 flex items-center gap-5 max-w-md pointer-events-auto">
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded">
                <Compass size={24} className="animate-spin text-blue-400" style={{ animationDuration: '6s' }} />
              </div>
              <div className="flex flex-col gap-0.5 text-left">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest leading-none">Detected Face Plane</span>
                <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                  Plane {selectedFaceInfo.plane} with offset
                  <input
                    type="number"
                    value={selectedFaceInfo.offset}
                    onChange={(e) => setSelectedFaceInfo({...selectedFaceInfo, offset: parseFloat(e.target.value) || 0})}
                    className="w-16 bg-black/50 border border-white/20 text-text-main rounded px-1.5 py-0.5 text-xs text-center font-mono focus:border-blue-500 outline-none"
                    step="1"
                  />
                  mm
                </span>
                <span className="text-[9.5px] text-text-muted max-w-[240px] leading-tight mt-0.5">
                  Create a new sketch plane aligned to this face to sketch and add features?
                </span>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  onClick={() => handleAddNewSketchOnFace(
                    selectedFaceInfo.plane, 
                    selectedFaceInfo.offset, 
                    undefined, 
                    selectedFaceInfo.faceNormal as [number, number, number],
                    selectedFaceInfo.point as [number, number, number]
                  )}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-text-main font-semibold text-xs rounded transition-all active:scale-95 cursor-pointer text-center"
                >
                  ✓ Create Sketch
                </button>
                <button
                  onClick={() => setSelectedFaceInfo(null)}
                  className="px-3 py-1 bg-highlight-subtle hover:bg-highlight-strong text-text-muted hover:text-text-main rounded text-[10px] text-center transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Unified Single 3D CAD Screen */}
          <div className="flex-1 w-full h-full min-h-0 relative">
            <CADViewport
              theme={theme}
              activeSketch={activeSketch}
              sketches={sketches}
              onUpdateActiveSketch={handleUpdateActiveSketch}
              operations={operations}
              material={material}
              onMeshCreated={handleMeshCreated}
              showEdgesOnly={showEdgesOnly}
              setShowEdgesOnly={setShowEdgesOnly}
              showSolid={
                !isSketchMode && (
                  currentHistory[safeHistoryIndex]?.type === "operation" ||
                  (importedBodies && importedBodies.length > 0)
                )
              }
              isSketchMode={isSketchMode}
              onEnterSketchMode={handleEnterSketchMode}
              onExitSketchMode={handleExitSketchMode}
              onFaceSelected={setSelectedFaceInfo}
              selectedFaceInfo={selectedFaceInfo}
              onAddNewSketchOnFace={handleAddNewSketchOnFace}
              onShowToast={showToast}
              importedBodies={importedBodies}
              onDeleteImportedBody={handleDeleteImportedBody}
              onDeleteImportedBodies={(ids: string[]) => {
                ids.forEach(id => bodyGeometryCache.delete(id));
                const idSet = new Set(ids);
                setImportedBodies(prev => prev.filter(body => !idSet.has(body.id)));
              }}
              onUpdateImportedBody={handleUpdateImportedBody}
              onUpdateImportedBodies={handleUpdateImportedBodies}
              selectedShapeIndices={selectedShapeIndices}
              onShapeClick={handleShapeClick}
              pendingOpType={pendingOpType}
              pendingHeight={pendingHeight}
              pendingAngle={pendingAngle}
              pendingBooleanOp={pendingBooleanOp}
              onConfirmOperation={handleConfirmOperation}
              onCancelOperation={handleCancelOperation}
              onChangePendingOpType={setPendingOpType}
              onChangePendingHeight={setPendingHeight}
              onChangePendingAngle={setPendingAngle}
              pendingRevolveAxisPoint1={pendingRevolveAxisPoint1}
              pendingRevolveAxisPoint2={pendingRevolveAxisPoint2}
              onChangePendingRevolveAxisPoint1={setPendingRevolveAxisPoint1}
              onChangePendingRevolveAxisPoint2={setPendingRevolveAxisPoint2}
              pendingBevelType={pendingBevelType}
              pendingBevelSize={pendingBevelSize}
              onChangePendingBevelType={setPendingBevelType}
              onChangePendingBevelSize={setPendingBevelSize}
              pendingTaperScale={pendingTaperScale}
              onChangePendingTaperScale={setPendingTaperScale}
              activeSolidOp={activeSolidOp}
              onChangeActiveSolidOp={setActiveSolidOp}
              selectedTargetSolidId={selectedTargetSolidId}
              selectedToolSolidId={selectedToolSolidId}
              onSolidSelect={handleSolidSelection}
              onConfirmSolidOp={handleConfirmSolidOp}
              onCancelSolidOp={handleCancelSolidOp}
              onSelectAllShapes={handleSelectAllShapes}
              edgeSelectionMode={edgeSelectionMode}
              selectedCorners={selectedCorners}
              onToggleCornerSelection={handleToggleCornerSelection}
              onUpdateSelectedCornersStyle={handleUpdateSelectedCornersStyle}
              onClearSelectedCorners={handleClearSelectedCorners}
              axisSelection={axisSelection}
              onSelectAxisPoint={handleSelectAxisPoint}
              activeRevolveAxis={(() => {
                const activeOp = operations.find(o => o.sketchId === activeSketch.id);
                return (activeOp?.parameters.revolveAxisPoint1 && activeOp?.parameters.revolveAxisPoint2)
                  ? { p1: activeOp.parameters.revolveAxisPoint1, p2: activeOp.parameters.revolveAxisPoint2 }
                  : (pendingRevolveAxisPoint1 && pendingRevolveAxisPoint2)
                    ? { p1: pendingRevolveAxisPoint1, p2: pendingRevolveAxisPoint2 }
                    : null;
              })()}
              previousIntersectionSegments={intersectionSegments}
            />
          </div>

          {/* Bottom Timeline */}
          <Timeline
            history={currentHistory}
            activeIndex={safeHistoryIndex}
            isSketchMode={isSketchMode}
            onEditSketch={handleEnterSketchMode}
            setActiveIndex={(index) => {
              setActiveHistoryIndex(index);
              const item = currentHistory[index];
              if (item) {
                if (item.type === "sketch") {
                  setActiveSketchId(item.refId);
                  setIsSketchMode(true);
                } else {
                  setIsSketchMode(false);
                  const op = operations.find(o => o.id === item.refId);
                  if (op) {
                    setActiveSketchId(op.sketchId);
                  }
                }
              }
            }}
            onDeleteHistoryItem={handleDeleteHistoryItem}
          />
        </div>
      </main>

      {/* Floating Auto-Import Toast for STEP Splitter */}
      {autoImportStatus && (
        <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-2xl backdrop-blur-md border transition-all flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300 ${
          autoImportStatus.error
            ? 'bg-red-950/90 border-red-500/50 text-red-200'
            : autoImportStatus.percent === 100
            ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
            : 'bg-[#0f172a]/95 border-cyan-500/50 text-cyan-200'
        }`}>
          {autoImportStatus.active && <RefreshCw size={18} className="animate-spin text-cyan-400 shrink-0" />}
          {autoImportStatus.error && <AlertCircle size={18} className="text-red-400 shrink-0" />}
          {!autoImportStatus.active && !autoImportStatus.error && <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />}
          <div className="flex flex-col min-w-[240px]">
            <span className="text-xs font-semibold">{autoImportStatus.message}</span>
            {autoImportStatus.active && (
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-cyan-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${autoImportStatus.percent}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {/* Share & Save Web Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        currentModelData={{
          name: activeProjectName.replace(/\.step$/i, ""),
          sketches,
          operations,
          activeSketchId,
          activePlane,
          material,
          importedBodies,
          theme
        }}
        onLoadProject={handleRestoreProjectData}
        onShowToast={showToast}
      />

      {/* Floating System Toast Alerts */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl border shadow-2xl backdrop-blur-md text-xs font-semibold flex items-center gap-2 animate-fadeIn pointer-events-auto transition-all ${
          toast.type === "error"
            ? "bg-red-950/90 border-red-500/50 text-red-200"
            : toast.type === "info"
            ? "bg-blue-950/90 border-blue-500/50 text-blue-200"
            : "bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
        }`}>
          {toast.type === "error" ? <AlertCircle size={16} className="text-red-400" /> : <CheckCircle2 size={16} className="text-emerald-400" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
      
  );
}

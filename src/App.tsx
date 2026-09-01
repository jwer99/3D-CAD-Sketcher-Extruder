/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
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
  Moon
} from "lucide-react";
import { SketchData, CADOperation, PlaneType, HistoryItem, PRESET_MATERIALS, MaterialStyle, Point2D, ImportedBody, BooleanOperation } from "./types";
import SketchCanvas from "./components/SketchCanvas";
import CADViewport from "./components/CADViewport";
import { getSolidRegions } from "./GeometryUtils";
import Sidebar from "./components/Sidebar";
import Timeline from "./components/Timeline";
import { exportToSTEP, exportToSTL, exportToOBJ } from "./ExporterSTEP";

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



export default function App() {
  // Theme state
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Current CAD workspace plane
  const [activePlane, setActivePlane] = useState<PlaneType>("XY");
  const [activeSketchId, setActiveSketchId] = useState<string>("sketch-xy");

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
      name: "Boceto XY (Suelo)",
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
      name: "Boceto XZ (Frente)",
      plane: "XZ",
      profiles: [],
      offset: 0
    },
    "sketch-yz": {
      id: "sketch-yz",
      name: "Boceto YZ (Perfil)",
      plane: "YZ",
      profiles: [],
      offset: 0
    }
  });

  const activeSketch = sketches[activeSketchId] || sketches["sketch-xy"] || Object.values(sketches)[0];

  // CAD 3D operations list (independent operation settings per plane)
  const [operations, setOperations] = useState<CADOperation[]>([]);

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
    if (selectedShapeIndices.length === 0) return;

    const existingOp = operations.find(o => o.sketchId === activeSketch.id);

    const newOp: CADOperation = {
      id: existingOp?.id || `op-${activeSketch.id}-${Date.now()}`,
      name: pendingOpType === "extrude" 
        ? (pendingBooleanOp === "cut" ? `Vaciado (${activeSketch.name})` : pendingBooleanOp === "join" ? `Unión (${activeSketch.name})` : `Extrusión (${activeSketch.name})`)
        : (pendingBooleanOp === "cut" ? `Vaciado Revo. (${activeSketch.name})` : pendingBooleanOp === "join" ? `Unión Revo. (${activeSketch.name})` : `Revolución (${activeSketch.name})`),
      type: pendingOpType,
      sketchId: activeSketch.id,
      selectedShapeIndices: [...selectedShapeIndices],
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
    if (sketch.profiles.length > 0) {
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
          name: op.type === "extrude" ? `Extruir (${sketch.name})` : `Revolución (${sketch.name})`
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

  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number>(0);
  
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
      name: `Op. Booleana (${activeSolidOp === "join" ? "Unión" : activeSolidOp === "cut" ? "Resta" : "Intersección"})`,
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
    const newBody: ImportedBody = {
      id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      vertices,
      normals,
      indices,
      color
    };
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
    const newBodies: ImportedBody[] = bodies.map(b => ({
      id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: b.name,
      vertices: b.vertices,
      normals: b.normals,
      indices: b.indices,
      color: b.color
    }));
    setImportedBodies(prev => [...prev, ...newBodies]);
  };

  const handleDeleteImportedBody = (id: string) => {
    setImportedBodies(prev => prev.filter(body => body.id !== id));
  };

  const handleUpdateImportedBody = (updatedBody: ImportedBody) => {
    setImportedBodies(prev => prev.map(b => b.id === updatedBody.id ? updatedBody : b));
  };

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

    // Filter previous/imported meshes
    const prevMeshes = meshes.filter(mesh => {
      if (mesh.userData.type === "imported") return true;
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
      if (mesh.userData.type === "imported") return true;
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
  }, [activeSketchId, activeSketch.plane, activeSketch.offset, sketches, operations, importedBodies]);

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
    const newSketchName = name || `Pieza ${plane} (${offset >= 0 ? "+" : ""}${offset}mm)`;
    
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
    
    // Auto point history selection to newly created sketch (mode sketch, not solid)
    setActiveHistoryIndex(0);
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

  // Trigger File Download in Browser Sandbox
  const downloadFile = (fileName: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    downloadFile("proyecto.cadproj", jsonStr, "application/json");
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
        alert("Error al cargar el proyecto: archivo invlido o daado.");
      }
    };
    reader.readAsText(file);
    event.target.value = ""; // Reset input so same file can be reloaded
  };

  // Export STEP Trigger
  const handleExportSTEP = () => {
    const bodies = activeThreeMeshesRef.current.map((mesh, index) => ({
      name: `Solid_Body_${index + 1}`,
      mesh
    }));

    if (bodies.length === 0) {
      alert("No geometry found to export. Sketch a shape first!");
      return;
    }

    const stepContent = exportToSTEP(bodies, sketches, operations);
    downloadFile("cad_model_exported.step", stepContent, "text/plain");
  };

  // Export STL Trigger
  const handleExportSTL = () => {
    const bodies = activeThreeMeshesRef.current.map((mesh, index) => ({
      name: `Solid_Body_${index + 1}`,
      mesh
    }));

    if (bodies.length === 0) {
      alert("No geometry found. Sketch a shape first!");
      return;
    }

    const stlContent = exportToSTL(bodies);
    downloadFile("cad_model_exported.stl", stlContent, "text/plain");
  };

  // Export OBJ Trigger
  const handleExportOBJ = () => {
    const bodies = activeThreeMeshesRef.current.map((mesh, index) => ({
      name: `Solid_Body_${index + 1}`,
      mesh
    }));

    if (bodies.length === 0) {
      alert("No geometry found. Sketch a shape first!");
      return;
    }

    const objContent = exportToOBJ(bodies);
    downloadFile("cad_model_exported.obj", objContent, "text/plain");
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-app text-text-main overflow-hidden select-none font-sans">
      
      {/* Top Application Header bar */}
      <header className="h-12 border-b border-border-main flex items-center justify-between px-6 bg-panel shrink-0 z-30">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center font-bold text-text-main text-xs shadow-md">
              V
            </div>
            <span className="font-bold text-sm tracking-widest text-text-main">
              VOXEL3D <span className="text-text-main/50 font-normal">CAD</span>
            </span>
          </div>
          <div className="h-4 w-[1px] bg-highlight-strong" />
          <div className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-widest font-mono">
            Generador B-Rep STEP
          </div>
        </div>

        {/* Quick Help Status bar */}
        <div className="flex items-center gap-4 text-xs">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="bg-highlight-subtle p-1.5 rounded border border-border-main text-text-muted hover:text-text-main hover:bg-highlight-strong transition-colors"
            title="Alternar Tema"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <div className="bg-highlight-subtle px-2.5 py-1 rounded border border-border-main font-mono text-text-main flex items-center gap-1.5">
            <span className="text-[10px] opacity-40">Pieza:</span>
            <span className="text-blue-400 font-semibold">Boceto_Solid_V1.step</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-muted font-mono text-[11px]">Unidades:</span>
            <span className="bg-highlight-subtle border border-border-main text-text-main px-1.5 py-0.5 rounded font-mono font-bold text-[11.5px]">mm</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            <span className="font-mono text-xs text-emerald-400">Cloud Synced</span>
          </div>
        </div>
      </header>

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
            const offsetStr = window.prompt(`Introduce el offset (desplazamiento en mm) para el nuevo plano ${activePlane}:`, "0");
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
          showSolid={currentHistory[safeHistoryIndex]?.type === "operation"}
          onSelectAllShapes={handleSelectAllShapes}
          edgeSelectionMode={edgeSelectionMode}
          onChangeEdgeSelectionMode={setEdgeSelectionMode}
          selectedCorners={selectedCorners}
          onUpdateSelectedCornersStyle={handleUpdateSelectedCornersStyle}
          onClearSelectedCorners={handleClearSelectedCorners}
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
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest leading-none">Plano de Cara Detectado</span>
                <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                  Plano {selectedFaceInfo.plane} con offset
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
                  ¿Quieres dibujar un nuevo boceto alineado a esta cara para añadir una nueva pieza al sólido?
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
                  ✓ Crear Boceto
                </button>
                <button
                  onClick={() => setSelectedFaceInfo(null)}
                  className="px-3 py-1 bg-highlight-subtle hover:bg-highlight-strong text-text-muted hover:text-text-main rounded text-[10px] text-center transition-all cursor-pointer"
                >
                  Cancelar
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
              showSolid={currentHistory[safeHistoryIndex]?.type === "operation"}
              onFaceSelected={setSelectedFaceInfo}
              selectedFaceInfo={selectedFaceInfo}
              onAddNewSketchOnFace={handleAddNewSketchOnFace}
              importedBodies={importedBodies}
              onDeleteImportedBody={handleDeleteImportedBody}
              onUpdateImportedBody={handleUpdateImportedBody}
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
            setActiveIndex={(index) => {
              setActiveHistoryIndex(index);
              const item = currentHistory[index];
              if (item) {
                if (item.type === "sketch") {
                  setActiveSketchId(item.refId);
                } else {
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
    </div>
      
  );
}
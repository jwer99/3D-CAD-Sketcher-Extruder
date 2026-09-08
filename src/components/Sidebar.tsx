/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  Download, 
  Settings, 
  Compass, 
  Sliders, 
  Layers, 
  FileCode, 
  Cpu, 
  RotateCw, 
  Expand,
  Dices,
  Play,
  Plus,
  Trash2,
  Upload,
  Sparkles,
  Image as ImageIcon,
  Camera,
  AlertCircle,
  Box,
  Scissors,
  Edit3,
  X
} from "lucide-react";
import { Profile, SketchData, CADOperation, PlaneType, Point2D, MaterialStyle, ImportedBody } from "../types";
import { parseSTEPInWorker, parseSTL, parseOBJ, extractSketchesFromGeometry } from "../ImporterParser";

interface SidebarProps {
  activePlane: PlaneType;
  onChangePlane: (plane: PlaneType) => void;
  sketches: Record<string, SketchData>;
  activeSketch: SketchData;
  onUpdateActiveSketch: (sketch: SketchData) => void;
  onUpdateSketchOffset?: (id: string, offset: number) => void;
  onSelectSketch: (id: string) => void;
  onDeleteSketch: (id: string) => void;
  onAddNewSketch: () => void;
  isSketchMode?: boolean;
  onEditSketch?: (id: string) => void;
  operations: CADOperation[];
  onUpdateOperations: (ops: CADOperation[]) => void;
  onSaveProject: () => void;
  onLoadProject: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onExportSTEP: () => void;
  onExportSTL: () => void;
  onExportOBJ: () => void;
  isSelectingAxis: boolean;
  onStartAxisSelection: () => void;
  onResetToDefaultAxis: () => void;
  importedBodies?: ImportedBody[];
  onImportBody?: (
    name: string, 
    vertices: number[] | Float32Array, 
    normals?: number[] | Float32Array, 
    indices?: number[] | Uint32Array | Uint16Array, 
    color?: [number, number, number]
  ) => void;
  onImportBodies?: (
    bodies: Array<{
      name: string;
      vertices: number[] | Float32Array;
      normals?: number[] | Float32Array;
      indices?: number[] | Uint32Array | Uint16Array;
      color?: [number, number, number];
    }>
  ) => void;
  onDeleteImportedBody?: (id: string) => void;
  onUpdateImportedBody?: (body: ImportedBody) => void;
  onUpdateImportedBodies?: (bodies: ImportedBody[]) => void;
  onImportSketches?: (sketches: SketchData[], customOps?: CADOperation[]) => void;

  selectedShapeIndices: number[];
  pendingOpType: "extrude" | "revolve";
  pendingHeight: number;
  pendingAngle: number;
  onConfirmOperation: () => void;
  onCancelOperation: () => void;
  onChangePendingOpType: (type: "extrude" | "revolve") => void;
  onChangePendingHeight: (height: number) => void;
  onChangePendingAngle: (angle: number) => void;
  pendingRevolveAxisPoint1?: Point2D;
  pendingRevolveAxisPoint2?: Point2D;
  onChangePendingRevolveAxisPoint1?: (p?: Point2D) => void;
  onChangePendingRevolveAxisPoint2?: (p?: Point2D) => void;
  pendingBevelType: "none" | "fillet" | "chamfer";
  pendingBevelSize: number;
  onChangePendingBevelType: (type: "none" | "fillet" | "chamfer") => void;
  onChangePendingBevelSize: (size: number) => void;
  pendingBooleanOp: "new-body" | "join" | "cut";
  onChangePendingBooleanOp: (op: "new-body" | "join" | "cut") => void;
  showSolid: boolean;
  onSelectAllShapes?: () => void;
  edgeSelectionMode: boolean;
  onChangeEdgeSelectionMode: (mode: boolean) => void;
  selectedCorners: { profileId: string; vertexIndex: number }[];
  onUpdateSelectedCornersStyle: (type: "none" | "fillet" | "chamfer", size: number) => void;
  onClearSelectedCorners: () => void;
}

export default function Sidebar({
  activePlane,
  onChangePlane,
  sketches,
  activeSketch,
  onUpdateActiveSketch,
  onUpdateSketchOffset,
  onSelectSketch,
  onDeleteSketch,
  onAddNewSketch,
  isSketchMode,
  onEditSketch,
  operations,
  onUpdateOperations,
  onSaveProject,
  onLoadProject,
  onExportSTEP,
  onExportSTL,
  onExportOBJ,
  isSelectingAxis,
  onStartAxisSelection,
  onResetToDefaultAxis,
  importedBodies = [],
  onImportBody,
  onImportBodies,
  onDeleteImportedBody,
  onImportSketches,
  selectedShapeIndices = [],
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
  onChangePendingRevolveAxisPoint1,
  onChangePendingRevolveAxisPoint2,
  pendingBevelType,
  pendingBevelSize,
  onChangePendingBevelType,
  onChangePendingBevelSize,
  pendingBooleanOp,
  onChangePendingBooleanOp,
  showSolid,
  onSelectAllShapes,
  edgeSelectionMode,
  onChangeEdgeSelectionMode,
  selectedCorners,
  onUpdateSelectedCornersStyle,
  onClearSelectedCorners
}: SidebarProps) {
  const [extrudeHeight, setExtrudeHeight] = useState<number>(30); // in mm
  const [revolveAngle, setRevolveAngle] = useState<number>(360); // in degrees
  const [activeOpType, setActiveOpType] = useState<"extrude" | "revolve">("extrude");
  const [bevelType, setBevelType] = useState<"none" | "fillet" | "chamfer">("none");
  const [bevelSize, setBevelSize] = useState<number>(1.0);
  const [booleanOp, setBooleanOp] = useState<"new-body" | "join" | "cut">("new-body");

  // States for Image Reconstruction
  const [reconstructMode, setReconstructMode] = useState<"cad" | "mesh">("cad");
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [reconstructError, setReconstructError] = useState<string | null>(null);
  const [reconstructSuccess, setReconstructSuccess] = useState<string | null>(null);
  const [apiKeyOverride, setApiKeyOverride] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number>(0);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [textPrompt, setTextPrompt] = useState("");
  // States for Import Progress and Errors
  const [importProgress, setImportProgress] = useState<{
    active: boolean;
    percent: number;
    stage: string;
    fileName: string;
  }>({
    active: false,
    percent: 0,
    stage: "",
    fileName: ""
  });
  const [importError, setImportError] = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setReconstructError(null);
    setReconstructSuccess(null);

    const newFiles: File[] = [];
    const newPreviews: string[] = [];
    let processedCount = 0;
    const totalFiles = Math.min(files.length, 6 - imagePreviews.length);

    if (totalFiles <= 0) {
      setReconstructError("Límite de 6 imágenes alcanzado. Elimina alguna para añadir más.");
      return;
    }

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        newPreviews.push(base64);
        newFiles.push(file);
        
        processedCount++;
        if (processedCount === totalFiles) {
          setImageFiles(prev => [...prev, ...newFiles]);
          setImagePreviews(prev => {
            const updated = [...prev, ...newPreviews];
            setActivePreviewIndex(updated.length - 1);
            return updated;
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (activePreviewIndex >= updated.length) {
        setActivePreviewIndex(Math.max(0, updated.length - 1));
      }
      return updated;
    });
    setReconstructError(null);
    setReconstructSuccess(null);
  };

  const handleRunReconstruction = async () => {
    if (imagePreviews.length === 0 && textPrompt.trim() === "") {
      setReconstructError("Por favor, selecciona una imagen o escribe un texto descriptivo.");
      return;
    }

    setIsReconstructing(true);
    setReconstructError(null);
    setReconstructSuccess(null);

    try {
      const response = await fetch("/api/reconstruct", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image: imagePreviews.length > 0 ? imagePreviews[0] : undefined,
          images: imagePreviews.length > 0 ? imagePreviews : undefined,
          textPrompt: textPrompt.trim() !== "" ? textPrompt : undefined,
          mode: reconstructMode,
          apiKey: apiKeyOverride || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error al procesar la reconstrucción.");
      }

      if (data.mode === "cad") {
        if (!data.sketches || data.sketches.length === 0) {
          throw new Error("No se devolvieron bocetos en el resultado CAD.");
        }

        const newSketches: SketchData[] = data.sketches.map((s: any, idx: number) => {
          const sketchId = `sketch-reconstructed-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`;
          return {
            id: sketchId,
            name: s.name || `Boceto IA ${idx + 1} (${s.plane})`,
            plane: s.plane || "XY",
            offset: s.offset || 0,
            profiles: (s.profiles || []).map((p: any, pIdx: number) => ({
              id: `profile-reconstructed-${Date.now()}-${idx}-${pIdx}`,
              type: p.type || "polygon",
              points: p.points || [],
              center: p.center,
              radius: p.radius,
              isClosed: p.isClosed !== undefined ? p.isClosed : true,
              cornerStyles: p.cornerStyles || {}
            }))
          };
        });

        const newOps: CADOperation[] = data.sketches.map((s: any, idx: number) => {
          const sketch = newSketches[idx];
          const op = s.operation || { type: "extrude", height: 20 };
          return {
            id: `op-${sketch.id}`,
            name: op.type === "extrude" ? `Extrusión (${sketch.name})` : `Revolución (${sketch.name})`,
            type: op.type || "extrude",
            sketchId: sketch.id,
            selectedShapeIndices: Array.from({ length: sketch.profiles.length }, (_, i) => i),
            parameters: {
              height: op.height || 20,
              angle: op.angle || 360,
              axis: op.axis || "Y",
              booleanOp: op.booleanOp || "new-body",
              bevelType: op.bevelType || "none",
              bevelSize: op.bevelSize !== undefined ? op.bevelSize : 0.8,
              taperScale: op.taperScale !== undefined ? op.taperScale : 1.0
            }
          };
        });

        if (onImportSketches) {
          onImportSketches(newSketches, newOps);
        }
        setReconstructSuccess("¡Pieza CAD reconstruida con éxito! Puedes editar sus bocetos y operaciones en la línea de timeline.");
      } else if (data.mode === "mesh") {
        if (!data.objText) {
          throw new Error("No se devolvió texto de malla OBJ.");
        }

        const geom = parseOBJ(data.objText);
        const posAttr = geom.getAttribute("position");
        if (posAttr) {
          const bodyName = imageFiles[0] ? `Malla_${imageFiles[0].name.split(".")[0]}` : `Malla_Reconstruida_${Date.now()}`;
          onImportBody?.(bodyName, posAttr.array as Float32Array);
          setReconstructSuccess("¡Malla 3D importada con éxito! Está lista para ser visualizada y exportada a STEP.");
        } else {
          throw new Error("No se pudo extraer geometría de la malla generada.");
        }
      }
    } catch (err: any) {
      setReconstructError(err.message || "Error desconocido durante la reconstrucción.");
    } finally {
      setIsReconstructing(false);
    }
  };


  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList) as File[];
    setImportError(null);

    const supportedFormats = ["step", "stp", "stl", "obj"];

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const name = file.name;
      const ext = name.split('.').pop()?.toLowerCase();
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const prefix = files.length > 1 ? `[${fileIndex + 1}/${files.length}] ` : "";

      if (!ext || !supportedFormats.includes(ext)) {
        setImportError(`Formato ".${ext || 'desconocido'}" no soportado para "${name}". Formatos válidos: .step, .stp, .stl, .obj`);
        continue;
      }

      if (file.size === 0) {
        setImportError(`El archivo "${name}" está vacío (0 bytes).`);
        continue;
      }

      setImportProgress({
        active: true,
        percent: 5,
        stage: `${prefix}Leyendo archivo (${fileSizeMB} MB)...`,
        fileName: name
      });

      await new Promise<void>((resolve) => {
        const reader = new FileReader();

        reader.onerror = () => {
          setImportError(`Error de lectura local al abrir el archivo "${name}".`);
          resolve();
        };

        reader.onprogress = (pe) => {
          if (pe.lengthComputable) {
            const p = Math.round((pe.loaded / pe.total) * 30);
            setImportProgress(prev => ({
              ...prev,
              percent: Math.min(30, Math.max(5, p)),
              stage: `${prefix}Cargando en memoria (${Math.round((pe.loaded / pe.total) * 100)}%)...`
            }));
          }
        };

        if (ext === "step" || ext === "stp") {
          reader.onload = async (event) => {
            const buffer = event.target?.result as ArrayBuffer;
            try {
              setImportProgress(prev => ({
                ...prev,
                percent: 35,
                stage: `${prefix}Iniciando análisis de geometría STEP...`
              }));

              const accumulatedChunkMeshes: any[] = [];
              const onProgress = (chunkMeshes: any[]) => {
                accumulatedChunkMeshes.push(...chunkMeshes);
                setImportProgress(prev => ({
                  ...prev,
                  percent: Math.min(95, prev.percent + 8),
                  stage: `${prefix}Extrayendo piezas (${accumulatedChunkMeshes.length} sólidas)...`
                }));
              };

              let stepMeshes: any[] = [];
              const fileSizeNum = buffer.byteLength / (1024 * 1024);

              // For files <= 25MB, use ultra-fast client-side WASM worker.
              if (fileSizeNum <= 25) {
                try {
                  setImportProgress(prev => ({
                    ...prev,
                    percent: 45,
                    stage: `${prefix}Triangulando superficies analíticas (WASM)...`
                  }));
                  const res = await parseSTEPInWorker(buffer, (chunkMeshes) => {
                    accumulatedChunkMeshes.push(...chunkMeshes);
                    setImportProgress(prev => ({
                      ...prev,
                      percent: Math.min(95, prev.percent + 6),
                      stage: `${prefix}Extrayendo piezas (${accumulatedChunkMeshes.length} sólidas)...`
                    }));
                  });
                  if (res && res.meshes && res.meshes.length > 0) {
                    stepMeshes = res.meshes;
                  }
                } catch (workerErr: any) {
                  console.warn("WASM worker step parsing failed, falling back to server:", workerErr);
                }
              }

              if (stepMeshes.length === 0 && accumulatedChunkMeshes.length === 0) {
                setImportProgress(prev => ({
                  ...prev,
                  percent: 40,
                  stage: `${prefix}Procesando archivo (${fileSizeNum.toFixed(1)} MB) en motor OpenCASCADE 64-bit...`
                }));

                const interval = setInterval(() => {
                  setImportProgress(prev => {
                    if (prev.percent < 90) {
                      return { ...prev, percent: prev.percent + 4, stage: `${prefix}Calculando topología, sólidos y colores B-Rep...` };
                    }
                    return prev;
                  });
                }, 800);

                let resp: Response;
                try {
                  resp = await fetch('/api/convert-step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: buffer
                  });
                } finally {
                  clearInterval(interval);
                }

                if (!resp.ok) {
                  const errJson = await resp.json().catch(() => ({}));
                  throw new Error(errJson.error || `Error del servidor (${resp.status}): ${resp.statusText}`);
                }

                const contentType = resp.headers.get("content-type") || "";
                if (contentType.includes("application/octet-stream")) {
                  const binBuf = await resp.arrayBuffer();
                  const view = new DataView(binBuf);
                  const decoder = new TextDecoder("utf-8");
                  let offset = 0;

                  const magic = decoder.decode(new Uint8Array(binBuf, offset, 8));
                  offset += 8;

                  if (magic !== "CADBIN01") {
                    throw new Error("Formato de respuesta binaria no reconocido o archivo dañado.");
                  }

                  const numMeshes = view.getUint32(offset, true);
                  offset += 4;

                  for (let i = 0; i < numMeshes; i++) {
                    const nameLen = view.getUint16(offset, true);
                    offset += 2;
                    const meshName = decoder.decode(new Uint8Array(binBuf, offset, nameLen));
                    offset += nameLen;

                    const r = view.getFloat32(offset, true);
                    const g = view.getFloat32(offset + 4, true);
                    const b = view.getFloat32(offset + 8, true);
                    offset += 12;

                    const numVerts = view.getUint32(offset, true);
                    const numNorms = view.getUint32(offset + 4, true);
                    const numInds = view.getUint32(offset + 8, true);
                    offset += 12;

                    const vertices = new Float32Array(binBuf.slice(offset, offset + numVerts * 4));
                    offset += numVerts * 4;

                    let normals: Float32Array | undefined = undefined;
                    if (numNorms > 0) {
                      normals = new Float32Array(binBuf.slice(offset, offset + numNorms * 4));
                      offset += numNorms * 4;
                    }

                    let indices: Uint32Array | undefined = undefined;
                    if (numInds > 0) {
                      indices = new Uint32Array(binBuf.slice(offset, offset + numInds * 4));
                      offset += numInds * 4;
                    }

                    stepMeshes.push({
                      name: meshName,
                      color: [r, g, b],
                      vertices,
                      normals,
                      indices
                    });
                  }
                } else {
                  const data = await resp.json();
                  if (!data.meshes || data.meshes.length === 0) {
                    throw new Error("No se encontraron piezas o geometría 3D válida en el archivo STEP.");
                  }
                  stepMeshes = data.meshes;
                }
              }
              
              const meshesToEmit = stepMeshes.length > 0 ? stepMeshes : accumulatedChunkMeshes;
              if (meshesToEmit.length > 0) {
                const batch = meshesToEmit.map((m, idx) => ({
                  name: m.name ? (m.name.includes(name) ? m.name : `${name} - ${m.name}`) : `${name} - Pieza ${idx + 1}`,
                  vertices: m.vertices instanceof Float32Array ? m.vertices : new Float32Array(m.vertices),
                  normals: m.normals ? (m.normals instanceof Float32Array ? m.normals : new Float32Array(m.normals)) : undefined,
                  indices: m.indices ? (m.indices instanceof Uint32Array ? m.indices : new Uint32Array(m.indices)) : undefined,
                  color: m.color
                }));

                if (onImportBodies) {
                  onImportBodies(batch);
                } else if (onImportBody) {
                  batch.forEach(b => onImportBody(b.name, b.vertices, b.normals, b.indices, b.color));
                }
              } else {
                throw new Error("No se pudo extraer ninguna pieza sólida o malla del archivo STEP.");
              }

              setImportProgress(prev => ({
                ...prev,
                percent: 100,
                stage: `${prefix}¡Importación completada!`
              }));
            } catch (err) {
              setImportError(`Error al importar "${name}": ` + (err as Error).message);
            } finally {
              resolve();
            }
          };
          reader.readAsArrayBuffer(file);
        } else if (ext === "stl") {
          reader.onload = (event) => {
            const buffer = event.target?.result as ArrayBuffer;
            try {
              setImportProgress(prev => ({ ...prev, percent: 70, stage: `${prefix}Parseando triángulos STL...` }));
              const geom = parseSTL(buffer);
              const posAttr = geom.getAttribute("position");
              if (posAttr && posAttr.count > 0) {
                onImportBody?.(name, Array.from(posAttr.array));
                setImportProgress(prev => ({ ...prev, percent: 100, stage: `${prefix}¡Malla STL importada!` }));
              } else {
                setImportError(`No se pudo extraer la geometría del archivo STL "${name}".`);
              }
            } catch (err) {
              setImportError(`Error al parsear el archivo STL "${name}": ` + (err as Error).message);
            } finally {
              resolve();
            }
          };
          reader.readAsArrayBuffer(file);
        } else if (ext === "obj") {
          reader.onload = (event) => {
            const text = event.target?.result as string;
            try {
              setImportProgress(prev => ({ ...prev, percent: 70, stage: `${prefix}Parseando polígonos OBJ...` }));
              const geom = parseOBJ(text);
              const posAttr = geom.getAttribute("position");
              if (posAttr && posAttr.count > 0) {
                onImportBody?.(name, Array.from(posAttr.array));
                setImportProgress(prev => ({ ...prev, percent: 100, stage: `${prefix}¡Malla OBJ importada!` }));
              } else {
                setImportError(`No se pudo extraer la geometría del archivo OBJ "${name}".`);
              }
            } catch (err) {
              setImportError(`Error al parsear el archivo OBJ "${name}": ` + (err as Error).message);
            } finally {
              resolve();
            }
          };
          reader.readAsText(file);
        }
      });
    }

    setTimeout(() => {
      setImportProgress(prev => ({ ...prev, active: false }));
    }, 1200);

    // Reset input value to allow uploading the same files again
    e.target.value = "";
  };

  // Synchronize local sidebar parameters with the active sketch's operation or pending parameters from parent
  React.useEffect(() => {
    const activeOp = operations.find(op => op.sketchId === activeSketch.id);
    if (activeOp) {
      setExtrudeHeight(activeOp.parameters.height);
      setRevolveAngle(activeOp.parameters.angle);
      setActiveOpType(activeOp.type);
      setBevelType(activeOp.parameters.bevelType ?? "fillet");
      setBevelSize(activeOp.parameters.bevelSize ?? 0.8);
      setBooleanOp(activeOp.parameters.booleanOp ?? "new-body");
    } else {
      setExtrudeHeight(pendingHeight);
      setRevolveAngle(pendingAngle);
      setActiveOpType(pendingOpType);
      setBevelType(pendingBevelType);
      setBevelSize(pendingBevelSize);
      setBooleanOp(pendingBooleanOp);
    }
  }, [activeSketch.id, operations, pendingHeight, pendingAngle, pendingOpType, pendingBevelType, pendingBevelSize, pendingBooleanOp]);

  // Custom Quick CAD Primitives Generator!
  const handleInjectPreset = (presetType: "nut" | "washer" | "bracket" | "star") => {
    let profiles: Profile[] = [];

    if (presetType === "nut") {
      // Hex Nut: A regular hexagon (outer) and a circle (inner hole)
      const hexPoints: Point2D[] = [];
      const outerRadius = 35;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
        hexPoints.push({
          x: Math.cos(angle) * outerRadius,
          y: Math.sin(angle) * outerRadius
        });
      }
      profiles.push({
        id: "hex-outer",
        type: "hexagon",
        points: hexPoints,
        isClosed: true
      });

      // Internal circle hole
      const innerRadius = 15;
      const circlePoints: Point2D[] = [];
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        circlePoints.push({
          x: Math.cos(angle) * innerRadius,
          y: Math.sin(angle) * innerRadius
        });
      }
      profiles.push({
        id: "circle-hole",
        type: "circle",
        points: circlePoints,
        isClosed: true
      });
    } 
    else if (presetType === "washer") {
      // Concentric circles forming a standard washer
      const outerPoints: Point2D[] = [];
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        outerPoints.push({
          x: Math.cos(angle) * 40,
          y: Math.sin(angle) * 40
        });
      }
      profiles.push({
        id: "washer-outer",
        type: "circle",
        points: outerPoints,
        isClosed: true
      });

      const innerPoints: Point2D[] = [];
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        innerPoints.push({
          x: Math.cos(angle) * 18,
          y: Math.sin(angle) * 18
        });
      }
      profiles.push({
        id: "washer-inner",
        type: "circle",
        points: innerPoints,
        isClosed: true
      });
    } 
    else if (presetType === "bracket") {
      // L Bracket side contour
      const points: Point2D[] = [
        { x: -30, y: -30 },
        { x: 30, y: -30 },
        { x: 30, y: -20 },
        { x: -20, y: -20 },
        { x: -20, y: 30 },
        { x: -30, y: 30 }
      ];
      profiles.push({
        id: "l-bracket",
        type: "polygon",
        points,
        isClosed: true
      });
    }
    else if (presetType === "star") {
      // 5-point star
      const starPoints: Point2D[] = [];
      const outerR = 35;
      const innerR = 15;
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? outerR : innerR;
        starPoints.push({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius
        });
      }
      profiles.push({
        id: "star-profile",
        type: "polygon",
        points: starPoints,
        isClosed: true
      });
    }

    onUpdateActiveSketch({
      ...activeSketch,
      profiles
    });
  };

  const handleUpdateHeight = (val: number) => {
    setExtrudeHeight(val);
    if (!showSolid) {
      onChangePendingHeight(val);
    } else {
      const updated = operations.map((op) => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            parameters: {
              ...op.parameters,
              height: val
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    }
  };

  const handleUpdateAxisPoint = (pointNum: 1 | 2, axis: 'x' | 'y', value: number) => {
    if (showSolid && activeOp) {
      const p1 = activeOp.parameters.revolveAxisPoint1;
      const p2 = activeOp.parameters.revolveAxisPoint2;
      const newP = pointNum === 1 
        ? { x: axis === 'x' ? value : (p1?.x || 0), y: axis === 'y' ? value : (p1?.y || 0) }
        : { x: axis === 'x' ? value : (p2?.x || 0), y: axis === 'y' ? value : (p2?.y || 0) };
      
      const updated = operations.map(op => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            parameters: {
              ...op.parameters,
              [pointNum === 1 ? 'revolveAxisPoint1' : 'revolveAxisPoint2']: newP
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    } else {
      const p1 = pendingRevolveAxisPoint1;
      const p2 = pendingRevolveAxisPoint2;
      const newP = pointNum === 1
        ? { x: axis === 'x' ? value : (p1?.x || 0), y: axis === 'y' ? value : (p1?.y || 0) }
        : { x: axis === 'x' ? value : (p2?.x || 0), y: axis === 'y' ? value : (p2?.y || 0) };
      
      if (pointNum === 1 && onChangePendingRevolveAxisPoint1) onChangePendingRevolveAxisPoint1(newP);
      if (pointNum === 2 && onChangePendingRevolveAxisPoint2) onChangePendingRevolveAxisPoint2(newP);
    }
  };

  const handleUpdateAngle = (val: number) => {
    setRevolveAngle(val);
    if (!showSolid) {
      onChangePendingAngle(val);
    } else {
      const updated = operations.map((op) => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            parameters: {
              ...op.parameters,
              angle: val
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    }
  };

  const handleToggleOpType = (type: "extrude" | "revolve") => {
    setActiveOpType(type);
    if (!showSolid) {
      onChangePendingOpType(type);
    } else {
      const updated = operations.map((op) => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            type,
            parameters: {
              ...op.parameters,
              height: extrudeHeight,
              angle: revolveAngle
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    }
  };

  const handleUpdateBevelType = (type: "none" | "fillet" | "chamfer") => {
    setBevelType(type);
    if (!showSolid) {
      onChangePendingBevelType(type);
    } else {
      const updated = operations.map((op) => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            parameters: {
              ...op.parameters,
              bevelType: type
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    }
  };

  const handleUpdateBevelSize = (size: number) => {
    setBevelSize(size);
    if (!showSolid) {
      onChangePendingBevelSize(size);
    } else {
      const updated = operations.map((op) => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            parameters: {
              ...op.parameters,
              bevelSize: size
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    }
  };

  const handleUpdateBooleanOp = (opVal: "new-body" | "join" | "cut") => {
    setBooleanOp(opVal);
    if (!showSolid) {
      onChangePendingBooleanOp(opVal);
    } else {
      const updated = operations.map((op) => {
        if (op.sketchId === activeSketch.id) {
          return {
            ...op,
            name: op.type === "extrude"
              ? (opVal === "cut" ? `Vaciado (${activeSketch.name})` : opVal === "join" ? `Unión (${activeSketch.name})` : `Extrusión (${activeSketch.name})`)
              : (opVal === "cut" ? `Vaciado Revo. (${activeSketch.name})` : opVal === "join" ? `Unión Revo. (${activeSketch.name})` : `Revolución (${activeSketch.name})`),
            parameters: {
              ...op.parameters,
              booleanOp: opVal
            }
          };
        }
        return op;
      });
      onUpdateOperations(updated);
    }
  };

  const activeOp = operations.find(op => op.sketchId === activeSketch.id);

  return (
    <div className="w-[340px] h-full bg-panel border-r border-border-main flex flex-col justify-between overflow-y-auto font-sans">
      {/* Sidebar Header Title */}
      <div className="p-4 border-b border-border-main">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-blue-600/20 border border-blue-500/50 text-blue-400 flex items-center justify-center font-bold">
            P
          </div>
          <div>
            <h1 className="font-sans font-bold text-sm text-text-main uppercase tracking-wider">PROPAGATOR 3D</h1>
            <p className="text-[10px] text-text-muted font-mono tracking-wide leading-none mt-0.5">Entorno de Diseño B-Rep</p>
          </div>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-5 flex-1">
        {/* Plane Selector Section */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px]">
            Plano de Trabajo (Sketch Plane)
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["XY", "XZ", "YZ"] as PlaneType[]).map((plane) => (
              <button
                key={plane}
                onClick={() => onChangePlane(plane)}
                className={`py-2 rounded text-xs font-semibold border transition-all ${
                  activePlane === plane 
                    ? "bg-blue-500/20 text-blue-400 border-blue-500/60 font-bold" 
                    : "bg-highlight-subtle text-text-muted border-border-subtle hover:text-text-main hover:bg-highlight-strong"
                }`}
              >
                {plane} <span className="text-[9px] opacity-50 block font-normal">{plane === "XY" ? "Suelo" : plane === "XZ" ? "Frente" : "Perfil"}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Active Sketches Tree list */}
        <div className="flex flex-col gap-2 bg-black/15 p-3 rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-text-muted uppercase tracking-[1.5px] flex items-center gap-1.5">
              <Layers size={11} className="text-emerald-400 animate-pulse" />
              <span>Bocetos y Piezas ({Object.keys(sketches || {}).length})</span>
            </label>
            <button
              onClick={onAddNewSketch}
              className="text-[9px] bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded font-semibold transition-all flex items-center gap-1 cursor-pointer"
              title="Añadir boceto de construcción"
            >
              <Plus size={9} />
              <span>Nuevo</span>
            </button>
          </div>
          
          <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-1">
            {Object.values(sketches || {}).map((sk) => {
              const isSelected = sk.id === activeSketch.id;
              const profileCount = sk.profiles.length;
              const isBasePlane = ["sketch-xy", "sketch-xz", "sketch-yz"].includes(sk.id);
              
              return (
                <div
                  key={sk.id}
                  onClick={() => onSelectSketch(sk.id)}
                  className={`flex items-center justify-between p-2 rounded text-xs transition-all border cursor-pointer select-none ${
                    isSelected
                      ? "bg-blue-600/15 border-blue-500/50 text-blue-400 font-bold shadow-md"
                      : "bg-[#18181b] hover:bg-surface/80 border-border-subtle text-text-main hover:text-text-main"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="p-1 pb-0.5 rounded bg-black/40 text-[9px] font-mono font-bold leading-none text-text-muted shrink-0">
                      {sk.plane}
                    </span>
                    <span className="truncate text-[11px]" title={sk.name}>
                      {sk.name}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex items-center" onClick={e => e.stopPropagation()}>
                      <input
                        type="number"
                        step="1"
                        className="w-10 bg-black/40 border border-border-subtle hover:border-border-main text-text-main rounded text-right text-[10px] px-1 py-0.5 focus:outline-none focus:border-blue-500 font-mono font-bold"
                        value={sk.offset || 0}
                        onChange={(e) => {
                          if (onUpdateSketchOffset) {
                            onUpdateSketchOffset(sk.id, parseFloat(e.target.value) || 0);
                          }
                        }}
                      />
                      <span className="text-[10px] text-text-muted ml-0.5 mr-1">mm</span>
                    </div>
                    <span className="text-[10px] px-1 rounded bg-highlight-subtle font-semibold text-text-muted text-[9px]">
                      {profileCount} fig
                    </span>
                    
                    {/* Edit sketch button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEditSketch) {
                          onEditSketch(sk.id);
                        } else {
                          onSelectSketch(sk.id);
                        }
                      }}
                      className={`p-1 rounded transition-colors cursor-pointer ${
                        isSelected && isSketchMode
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                          : "text-text-muted hover:text-emerald-400 hover:bg-highlight-subtle"
                      }`}
                      title="Editar este boceto en Modo Boceto"
                    >
                      <Edit3 size={11} />
                    </button>

                    {/* Delete custom sketch button */}
                    {!isBasePlane && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSketch(sk.id);
                        }}
                        className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-highlight-subtle transition-colors cursor-pointer"
                        title="Borrar boceto"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Imported STEP Bodies List in Sidebar */}
          {importedBodies && importedBodies.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border-subtle/50 flex flex-col gap-1.5">
              <label className="text-[9px] font-bold text-blue-400 uppercase tracking-[1px] flex items-center gap-1">
                <Box size={10} />
                <span>Piezas Importadas STEP ({importedBodies.length})</span>
              </label>
              <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto pr-1">
                {importedBodies.map(body => (
                  <div 
                    key={body.id}
                    className="flex items-center justify-between p-1.5 px-2 bg-black/30 rounded border border-border-subtle hover:border-blue-500/40 transition-colors text-xs"
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <div 
                        className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20" 
                        style={{ backgroundColor: body.color ? `rgb(${Math.round(body.color[0]*255)}, ${Math.round(body.color[1]*255)}, ${Math.round(body.color[2]*255)})` : '#3b82f6' }}
                      />
                      <span className="truncate text-[11px] font-mono text-text-main" title={body.name}>
                        {body.name}
                      </span>
                    </div>
                    {onDeleteImportedBody && (
                      <button
                        onClick={() => onDeleteImportedBody(body.id)}
                        className="p-1 text-text-muted hover:text-red-400 hover:bg-highlight-subtle rounded transition-colors cursor-pointer shrink-0"
                        title="Borrar pieza importada"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CAD operation Type toggle */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px]">
            Operación de Modelado
          </label>
          <div className="flex rounded bg-surface-hover p-1 border border-border-subtle">
            <button
              onClick={() => handleToggleOpType("extrude")}
              className={`flex-1 py-1.5 rounded text-xs font-semibold text-center transition-all ${
                activeOpType === "extrude"
                  ? "bg-blue-600 text-text-main shadow"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Extruir
            </button>
            <button
              onClick={() => handleToggleOpType("revolve")}
              className={`flex-1 py-1.5 rounded text-xs font-semibold text-center transition-all ${
                activeOpType === "revolve"
                  ? "bg-blue-600 text-text-main shadow"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Revolución
            </button>
          </div>
        </div>

        {/* Boolean Operation toggle */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px]">
            Efecto de Volumen (Boolean Op)
          </label>
          <div className="flex rounded bg-surface-hover p-1 border border-border-subtle">
            <button
              onClick={() => handleUpdateBooleanOp("new-body")}
              className={`flex-1 py-1.5 rounded text-xs font-semibold text-center transition-all ${
                booleanOp === "new-body"
                  ? "bg-blue-600 text-text-main shadow"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Nuevo
            </button>
            <button
              onClick={() => handleUpdateBooleanOp("join")}
              className={`flex-1 py-1.5 rounded text-xs font-semibold text-center transition-all ${
                booleanOp === "join"
                  ? "bg-emerald-600 text-text-main shadow"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Unir
            </button>
            <button
              onClick={() => handleUpdateBooleanOp("cut")}
              className={`flex-1 py-1.5 rounded text-xs font-semibold text-center transition-all ${
                booleanOp === "cut"
                  ? "bg-red-600 text-text-main shadow"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Vaciado
            </button>
          </div>
        </div>

        {/* Parameters Sliders */}
        <div className="flex flex-col gap-3 bg-[#1A1A1A] p-3 rounded-lg border border-border-subtle">
          {/* Visual Callout Guides */}
          {!showSolid && selectedShapeIndices.length === 0 && !activeOp && activeSketch.profiles.length > 0 && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded text-xs leading-relaxed flex flex-col gap-1.5 animate-fadeIn">
              <span className="font-bold text-[10px] uppercase tracking-wider flex items-center gap-1">
                <Compass size={11} className="animate-pulse" />
                <span>Elegir Región en 3D</span>
              </span>
              <p className="text-[10px] text-text-main">
                Haz clic en una o más áreas cerradas del boceto en la <strong>vista 3D</strong> para seleccionar qué extruir o revolucionar.
              </p>
              {onSelectAllShapes && (
                <button
                  onClick={onSelectAllShapes}
                  className="mt-1 py-1 bg-blue-600/25 hover:bg-blue-600 border border-blue-500/40 text-blue-400 hover:text-text-main rounded text-[10px] font-bold transition-all cursor-pointer text-center"
                >
                  Seleccionar Todo
                </button>
              )}
            </div>
          )}

          {!showSolid && selectedShapeIndices.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded text-xs leading-relaxed flex flex-col gap-2 animate-fadeIn">
              <span className="font-bold text-[10px] uppercase tracking-wider">
                Operación Pendiente
              </span>
              <p className="text-[10px] text-text-main font-medium">
                Tienes {selectedShapeIndices.length} {selectedShapeIndices.length === 1 ? "región seleccionada" : "regiones seleccionadas"}.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-0.5">
                <button
                  onClick={onConfirmOperation}
                  className="py-1.5 bg-emerald-600 hover:bg-emerald-500 text-text-main font-bold text-xs rounded transition-all cursor-pointer text-center"
                >
                  ✓ Confirmar
                </button>
                <button
                  onClick={onCancelOperation}
                  className="py-1.5 bg-surface hover:bg-zinc-700 text-text-main font-bold text-xs rounded border border-border-subtle transition-all cursor-pointer text-center"
                >
                  Cancelar
                </button>
              </div>
              {onSelectAllShapes && (
                <button
                  onClick={onSelectAllShapes}
                  className="w-full py-1 text-center text-[10px] text-amber-500 hover:text-amber-400 font-semibold transition-all border border-amber-500/20 hover:border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 rounded cursor-pointer"
                >
                  Seleccionar Todo
                </button>
              )}
            </div>
          )}

          {showSolid && activeOp && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded text-xs leading-relaxed flex flex-col gap-1.5 animate-fadeIn">
              <span className="font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Edición de Sólido</span>
              </span>
              <p className="text-[10px] text-text-main leading-tight">
                Estás editando el sólido confirmado. Los cambios en los controles se actualizan y guardan automáticamente en tiempo real.
              </p>
            </div>
          )}

          {activeOpType === "extrude" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-text-muted">Altura de Extrusión</span>
                <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded font-mono font-bold text-[11px]">
                  {extrudeHeight} mm
                </span>
              </div>
              <input
                type="range"
                min="-60"
                max="100"
                step="2"
                value={extrudeHeight}
                onChange={(e) => handleUpdateHeight(parseInt(e.target.value))}
                className="w-full h-1 bg-highlight-strong accent-blue-500 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-text-muted leading-tight">Valor positivo extruye arriba; negativo hacia abajo.</span>

              {/* Corner Styling (Bevel/Fillet/Chamfer) */}
              <div className="mt-3 pt-3 border-t border-border-subtle flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-text-muted">Estilo de Esquina (3D)</span>
                </div>
                <div className="flex rounded bg-black/30 p-0.5 border border-border-subtle">
                  {(["none", "fillet", "chamfer"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleUpdateBevelType(type)}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold text-center transition-all cursor-pointer ${
                        bevelType === type
                          ? "bg-blue-600 text-text-main shadow font-bold"
                          : "text-text-muted hover:text-text-main"
                      }`}
                    >
                      {type === "none" ? "Ninguno" : type === "fillet" ? "Redondeado" : "Chaflán"}
                    </button>
                  ))}
                </div>
                
                {bevelType !== "none" && (
                  <div className="flex flex-col gap-1.5 mt-1.5 animate-fadeIn">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-text-muted">{bevelType === "fillet" ? "Radio de Redondeo" : "Distancia de Chaflán"}</span>
                      <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded font-mono font-bold text-[11px]">
                        {bevelSize.toFixed(1)} mm
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="10"
                      step="0.2"
                      value={bevelSize}
                      onChange={(e) => handleUpdateBevelSize(parseFloat(e.target.value))}
                      className="w-full h-1 bg-highlight-strong accent-blue-500 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                )}
              </div>

              {/* Vertical Edge Filleting/Chamfering (Select Edges) */}
              <div className="mt-3 pt-3 border-t border-border-subtle flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onChangeEdgeSelectionMode(!edgeSelectionMode)}
                  className={`w-full py-1.5 px-3 rounded flex items-center justify-center gap-2 text-xs font-semibold border transition-all cursor-pointer ${
                    edgeSelectionMode
                      ? "bg-blue-600 text-text-main border-blue-500/50 shadow-[0_2px_8px_rgba(37,99,235,0.4)]"
                      : "bg-surface text-text-muted border-border-subtle hover:bg-highlight-subtle hover:text-text-main"
                  }`}
                >
                  <Cpu size={14} />
                  <span>{edgeSelectionMode ? "V Modo Selección Activo" : "Seleccionar Aristas / Esquinas"}</span>
                </button>

                {edgeSelectionMode && (
                  <p className="text-[10px] text-text-muted leading-snug">
                    Haz clic en los vértices del boceto 2D o en las aristas verticales de la vista 3D para seleccionarlos y aplicarles un chaflán/empalme.
                  </p>
                )}

                {selectedCorners.length > 0 && (() => {
                  const getSelectedCornersCommonStyle = () => {
                    if (selectedCorners.length === 0) return { type: "none" as const, size: 2.0 };
                    const first = selectedCorners[0];
                    const profile = activeSketch.profiles.find(p => p.id === first.profileId);
                    const style = profile?.cornerStyles?.[first.vertexIndex];
                    if (!style) return { type: "none" as const, size: 2.0 };

                    let allSameType = true;
                    let allSameSize = true;
                    selectedCorners.forEach(c => {
                      const p = activeSketch.profiles.find(prof => prof.id === c.profileId);
                      const s = p?.cornerStyles?.[c.vertexIndex];
                      if (!s || s.type !== style.type) allSameType = false;
                      if (!s || s.size !== style.size) allSameSize = false;
                    });

                    return {
                      type: allSameType ? style.type : ("mixed" as any),
                      size: allSameSize ? style.size : 2.0
                    };
                  };

                  const commonStyle = getSelectedCornersCommonStyle();

                  return (
                    <div className="mt-2 p-2.5 bg-blue-500/5 border border-blue-500/20 rounded flex flex-col gap-2 animate-fadeIn">
                      <div className="flex justify-between items-center text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                        <span>Aristas Seleccionadas ({selectedCorners.length})</span>
                        <button
                          type="button"
                          onClick={onClearSelectedCorners}
                          className="text-[9px] hover:text-blue-300 underline cursor-pointer"
                        >
                          Limpiar
                        </button>
                      </div>

                      <div className="flex rounded bg-black/35 p-0.5 border border-border-subtle">
                        {(["none", "fillet", "chamfer"] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => onUpdateSelectedCornersStyle(type, commonStyle.size)}
                            className={`flex-1 py-1 rounded text-[9px] font-semibold text-center transition-all cursor-pointer ${
                              commonStyle.type === type
                                ? "bg-blue-600 text-text-main font-bold shadow"
                                : "text-text-muted hover:text-text-main"
                            }`}
                          >
                            {type === "none" ? "Ninguno" : type === "fillet" ? "Redondeado" : "Chaflán"}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-col gap-1 mt-1">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-text-muted">Radio / Distancia:</span>
                          <span className="text-blue-400 font-mono font-bold">
                            {commonStyle.type === "none" ? "0.0 mm" : (commonStyle.type === "mixed" ? "Mixto" : `${commonStyle.size.toFixed(1)} mm`)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="20"
                          step="0.5"
                          value={commonStyle.type === "none" || commonStyle.type === "mixed" ? 2.0 : commonStyle.size}
                          onChange={(e) => {
                            const type = (commonStyle.type === "none" || commonStyle.type === "mixed") ? "fillet" : commonStyle.type;
                            onUpdateSelectedCornersStyle(type, parseFloat(e.target.value));
                          }}
                          className="w-full h-1 bg-highlight-strong accent-blue-500 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 animate-fadeIn">
              <div className="flex justify-between items-center text-xs">
                <span className="text-text-muted">Ángulo de Revolución</span>
                <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded font-mono font-bold text-[11px]">
                  {revolveAngle}°
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="360"
                step="10"
                value={revolveAngle}
                onChange={(e) => handleUpdateAngle(parseInt(e.target.value))}
                className="w-full h-1 bg-highlight-strong accent-blue-500 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-text-muted leading-tight">Gira el perfil alrededor de la referencia vertical Y o eje personalizado.</span>

              {/* Custom Revolve Axis Selector */}
              <div className="mt-3 pt-3 border-t border-border-subtle flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-text-main/40 uppercase tracking-[1px]">Eje de Revolución</span>
                
                <div className="bg-black/25 p-2 rounded border border-border-subtle flex flex-col gap-1 text-[11px]">
                    <div className="flex justify-between text-text-main">
                      <span>Eje activo:</span>
                      <span className="font-semibold text-amber-400 font-mono">
                        {showSolid
                          ? (activeOp?.parameters.revolveAxisPoint1 && activeOp?.parameters.revolveAxisPoint2 ? `Línea (2 Puntos)` : `Por defecto (${activeOp?.parameters.axis || "Y"})`)
                          : (pendingRevolveAxisPoint1 && pendingRevolveAxisPoint2 ? `Línea (2 Puntos)` : `Por defecto (Y)`)}
                      </span>
                    </div>
                    {((showSolid ? activeOp?.parameters.revolveAxisPoint1 : pendingRevolveAxisPoint1) && (showSolid ? activeOp?.parameters.revolveAxisPoint2 : pendingRevolveAxisPoint2)) && (
                        <div className="text-[10px] text-text-muted font-mono bg-black/40 p-1.5 rounded mt-1 flex flex-col gap-1 border border-border-subtle">
                          <div className="flex items-center gap-1">
                            <span className="w-3">A:</span>
                            <input type="number" value={showSolid ? activeOp!.parameters.revolveAxisPoint1!.x : pendingRevolveAxisPoint1!.x} onChange={e => handleUpdateAxisPoint(1, 'x', parseFloat(e.target.value))} className="w-12 bg-transparent border-b border-white/20 outline-none text-right hover:border-amber-400 focus:border-amber-400" />
                            <span>,</span>
                            <input type="number" value={showSolid ? activeOp!.parameters.revolveAxisPoint1!.y : pendingRevolveAxisPoint1!.y} onChange={e => handleUpdateAxisPoint(1, 'y', parseFloat(e.target.value))} className="w-12 bg-transparent border-b border-white/20 outline-none text-right hover:border-amber-400 focus:border-amber-400" />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-3">B:</span>
                            <input type="number" value={showSolid ? activeOp!.parameters.revolveAxisPoint2!.x : pendingRevolveAxisPoint2!.x} onChange={e => handleUpdateAxisPoint(2, 'x', parseFloat(e.target.value))} className="w-12 bg-transparent border-b border-white/20 outline-none text-right hover:border-amber-400 focus:border-amber-400" />
                            <span>,</span>
                            <input type="number" value={showSolid ? activeOp!.parameters.revolveAxisPoint2!.y : pendingRevolveAxisPoint2!.y} onChange={e => handleUpdateAxisPoint(2, 'y', parseFloat(e.target.value))} className="w-12 bg-transparent border-b border-white/20 outline-none text-right hover:border-amber-400 focus:border-amber-400" />
                          </div>
                        </div>
                      )}
                  </div>

                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  <button
                    onClick={onStartAxisSelection}
                    className={`px-2 py-1.5 rounded font-semibold text-[11px] transition-all border cursor-pointer text-center flex items-center justify-center gap-1 ${
                      isSelectingAxis 
                        ? "bg-amber-500/20 border-amber-500 text-amber-400 animate-pulse" 
                        : "bg-amber-600/10 hover:bg-amber-600/20 border-amber-500/30 text-amber-400"
                    }`}
                  >
                    <Compass size={11} className={isSelectingAxis ? "animate-spin" : ""} />
                    <span>{isSelectingAxis ? "Paso 1: Clic P1" : "Elegir 2 Puntos"}</span>
                  </button>

                  <button
                    onClick={onResetToDefaultAxis}
                    disabled={showSolid ? !activeOp?.parameters.revolveAxisPoint1 : !pendingRevolveAxisPoint1}
                    className={`px-2 py-1.5 rounded font-semibold text-[11px] transition-all border cursor-pointer text-center ${
                      (showSolid ? activeOp?.parameters.revolveAxisPoint1 : pendingRevolveAxisPoint1)
                        ? "bg-surface hover:bg-zinc-700 hover:text-text-main border-border-main text-text-main"
                        : "bg-app border-transparent text-text-muted cursor-not-allowed"
                    }`}
                    title="Restablecer al eje Y vertical por defecto"
                  >
                    Restablecer
                  </button>
                </div>

                {isSelectingAxis && (
                  <span className="text-[10px] text-amber-500 font-medium animate-pulse leading-snug mt-0.5">
                    Toca 2 puntos en el boceto 2D de la izquierda (ej. vértices o rejilla) para trazar el eje virtual.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Foto a 3D con IA Section */}
        <div className="flex flex-col gap-3 bg-panel p-3.5 rounded border border-border-subtle relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 blur-2xl rounded-full group-hover:bg-purple-500/10 transition-all duration-300"></div>
          
          <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px] flex items-center justify-between z-10">
            <span className="flex items-center gap-1">
              <Sparkles size={11} className="text-purple-400" />
              Reconstrucción 3D con IA
            </span>
            <span className="text-[8px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 py-0.2 rounded font-mono font-bold animate-pulse">PRO</span>
          </label>

          {/* Selector de modo */}
          <div className="flex flex-col gap-1.5 z-10">
            <span className="text-[9px] text-text-muted font-bold uppercase tracking-wider">Método de Reconstrucción</span>
            <div className="grid grid-cols-2 gap-1 bg-black/40 p-0.5 rounded border border-border-subtle">
              <button
                type="button"
                onClick={() => setReconstructMode("cad")}
                className={`py-1 rounded text-[9.5px] font-bold cursor-pointer transition-all ${
                  reconstructMode === "cad"
                    ? "bg-purple-600/20 text-purple-400 border border-purple-500/20"
                    : "text-text-muted hover:text-text-main border border-transparent"
                }`}
                title="Genera boceto CAD paramétrico editable y sólido con Gemini"
              >
                CAD Paramétrico
              </button>
              <button
                type="button"
                onClick={() => setReconstructMode("mesh")}
                className={`py-1 rounded text-[9.5px] font-bold cursor-pointer transition-all ${
                  reconstructMode === "mesh"
                    ? "bg-purple-600/20 text-purple-400 border border-purple-500/20"
                    : "text-text-muted hover:text-text-main border border-transparent"
                }`}
                title="Genera una malla 3D estanca (OBJ) con la IA de Gemini"
              >
                Malla 3D (IA)
              </button>
            </div>
          </div>

          {/* Text-to-CAD Input */}
          <div className="relative z-10 flex flex-col gap-2 mb-2">
            <textarea
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              placeholder="Ej: Soporte en L de 50x50mm con grosor de 5mm y un agujero circular de 10mm en el centro..."
              className="w-full h-20 bg-black/40 text-purple-200 border border-purple-500/20 rounded p-2 text-xs focus:outline-none focus:border-purple-500/50 resize-none placeholder-purple-500/30 font-medium"
            />
          </div>

          {/* Upload image area & gallery */}
          <div className="relative z-10 flex flex-col gap-2">
            <input 
              type="file" 
              accept="image/*" 
              multiple
              onChange={handleImageChange}
              className="hidden" 
              id="image-reconstruct-input"
            />
            
            {imagePreviews.length > 0 ? (
              <div className="flex flex-col gap-2">
                {/* Main Active Viewer */}
                <div className="relative group border border-purple-500/30 rounded overflow-hidden aspect-video bg-black/60 flex items-center justify-center">
                  <img src={imagePreviews[activePreviewIndex]} alt={`Preview ${activePreviewIndex}`} className="max-h-full max-w-full object-contain" />
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/75 rounded border border-border-main text-[9px] text-purple-300 font-mono font-semibold">
                    Ángulo {activePreviewIndex + 1} de {imagePreviews.length}
                  </div>
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                    <label 
                      htmlFor="image-reconstruct-input" 
                      className="cursor-pointer bg-purple-600 text-text-main font-extrabold text-[10px] px-3 py-1.5 rounded transition hover:bg-purple-500 shadow-md"
                    >
                      Añadir más fotos
                    </label>
                  </div>
                </div>

                {/* Kiri photogrammetry grid style */}
                <div className="grid grid-cols-4 gap-1.5">
                  {imagePreviews.map((preview, idx) => (
                    <div 
                      key={idx}
                      onClick={() => setActivePreviewIndex(idx)}
                      className={`relative aspect-square rounded overflow-hidden bg-black/40 border cursor-pointer transition-all ${
                        activePreviewIndex === idx 
                          ? "border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)] scale-95" 
                          : "border-border-subtle hover:border-white/20 hover:scale-95"
                      }`}
                    >
                      <img src={preview} alt={`Thumb ${idx}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteImage(idx);
                        }}
                        className="absolute top-1 right-1 bg-red-600/90 text-text-main rounded-full p-0.5 hover:bg-red-500 transition-colors shadow cursor-pointer border border-red-500/20"
                        title="Eliminar foto"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  ))}

                  {imagePreviews.length < 6 && (
                    <label
                      htmlFor="image-reconstruct-input"
                      className="aspect-square border border-dashed border-border-main hover:border-purple-500/40 bg-black/20 hover:bg-purple-500/5 rounded flex flex-col items-center justify-center gap-0.5 text-text-muted hover:text-purple-400 transition-all cursor-pointer"
                      title="Añadir otra toma del objeto"
                    >
                      <Plus size={14} />
                      <span className="text-[8px] font-bold uppercase tracking-wider">Añadir</span>
                    </label>
                  )}
                </div>
              </div>
            ) : (
              <label 
                htmlFor="image-reconstruct-input"
                className="w-full h-28 border border-dashed border-border-main hover:border-purple-500/50 bg-black/20 hover:bg-black/40 rounded transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5 text-text-muted hover:text-text-main text-[10.5px] text-center px-4"
              >
                <Camera size={22} className="text-text-muted group-hover:text-purple-400 transition-colors" />
                <span className="font-extrabold text-text-main">Escanear Objeto (Estilo Kiri Engine)</span>
                <span className="text-text-muted text-[8.5px] leading-tight">Sube de 1 a 6 fotos de tu pieza desde varios ángulos (frontal, lateral, superior y perspectiva)</span>
                <span className="text-[8px] text-text-muted font-mono">PNG, JPG, WEBP (Soporta Multiselección)</span>
              </label>
            )}
          </div>

          {/* Configuración de API opcional */}
          <div className="flex flex-col gap-1 z-10">
            <button
              type="button"
              onClick={() => setShowApiSettings(!showApiSettings)}
              className="text-[9.5px] text-text-muted hover:text-text-muted font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>{showApiSettings ? "Ocultar" : "Mostrar"} configuración de API</span>
            </button>
            
            {showApiSettings && (
              <input
                type="password"
                placeholder="GEMINI_API_KEY (dejar vacío para usar .env)"
                value={apiKeyOverride}
                onChange={(e) => setApiKeyOverride(e.target.value)}
                className="w-full px-2 py-1.5 bg-black/40 border border-border-main text-text-main rounded text-[10.5px] font-mono focus:border-purple-500/50 outline-none"
              />
            )}
          </div>

          {/* Error and Success notifications */}
          {reconstructError && (
            <div className="p-2 bg-red-950/20 border border-red-500/20 text-red-400 text-[10px] rounded flex gap-1.5 items-start leading-snug z-10">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{reconstructError}</span>
            </div>
          )}

          {reconstructSuccess && (
            <div className="p-2 bg-emerald-950/20 border border-emerald-500/20 text-emerald-400 text-[10px] rounded flex gap-1.5 items-start leading-snug z-10 animate-fade-in">
              <Sparkles size={12} className="shrink-0 mt-0.5 text-emerald-400" />
              <span>{reconstructSuccess}</span>
            </div>
          )}

          {/* Generate Button */}
          <button
            type="button"
            disabled={isReconstructing || (imagePreviews.length === 0 && textPrompt.trim() === "")}
            onClick={handleRunReconstruction}
            className={`w-full py-2 rounded text-[11px] font-extrabold transition-all duration-150 z-10 flex items-center justify-center gap-1.5 cursor-pointer shadow-md ${
              isReconstructing 
                ? "bg-purple-900/40 text-purple-300/60 border border-purple-500/10 cursor-not-allowed"
                : (imagePreviews.length === 0 && textPrompt.trim() === "")
                ? "bg-app border border-border-subtle text-text-muted cursor-not-allowed"
                : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-text-main active:scale-98"
            }`}
          >
            {isReconstructing ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-purple-400 animate-spin" />
                <span>Reconstruyendo...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} className={(imagePreviews.length === 0 && textPrompt.trim() === "") ? "opacity-50" : "animate-pulse"} />
                <span>{textPrompt.trim() !== "" && imagePreviews.length === 0 ? "Generar desde Texto" : "Reconstruir Pieza"}</span>
              </>
            )}
          </button>
        </div>

        {/* Modelos Importados Section */}
        <div className="flex flex-col gap-2 bg-panel p-3.5 rounded border border-border-subtle">
          <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px] flex items-center justify-between">
            <span>Modelos 3D Importados</span>
            <span className="text-[8px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1 py-0.2 rounded font-mono font-bold">NUEVO</span>
          </label>
          
          {/* File Input */}
          <div className="relative">
            <input 
              type="file" 
              accept=".step,.stp,.stl,.obj" 
              multiple
              onChange={handleImportFile}
              disabled={importProgress.active}
              className="hidden" 
              id="file-import-input"
            />
            <label 
              htmlFor={importProgress.active ? undefined : "file-import-input"}
              className={`w-full py-2 border rounded text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm text-center ${
                importProgress.active 
                  ? "bg-blue-900/30 border-blue-500/30 text-blue-300 cursor-wait" 
                  : "bg-blue-950/20 hover:bg-blue-600 border-blue-500/20 text-blue-400 hover:text-text-main cursor-pointer active:scale-98"
              }`}
            >
              {importProgress.active ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-blue-400 animate-spin" />
              ) : (
                <Upload size={12} />
              )}
              <span>{importProgress.active ? "Procesando Modelos CAD..." : "Importar STEP / STL / OBJ (Múltiples)"}</span>
            </label>
            
            {/* Quick access to STEP Splitter for files > 100MB */}
            <a
              href="/splitter.html"
              target="_blank"
              rel="noreferrer"
              className="w-full mt-1.5 py-1.5 px-2.5 bg-gradient-to-r from-cyan-950/40 via-blue-950/30 to-slate-900 border border-cyan-500/30 hover:border-cyan-400/60 rounded text-[10.5px] font-semibold text-cyan-300 hover:text-cyan-200 transition-all flex items-center justify-between gap-1.5 shadow-sm active:scale-98 group"
              title="Herramienta complementaria para dividir archivos STEP de 750MB o más en partes de <=100MB"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Scissors size={12} className="text-cyan-400 group-hover:rotate-12 transition-transform shrink-0" />
                <span className="truncate">Dividir STEP Grande (&gt;100 MB)</span>
              </div>
              <span className="text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1 py-0.5 rounded font-mono font-bold shrink-0">
                APP ✂️
              </span>
            </a>
            {/* Import Error Message */}
            {importError && (
              <div className="p-2.5 bg-red-950/30 border border-red-500/30 text-red-300 text-[10px] rounded flex gap-2 items-start leading-snug animate-fade-in">
                <AlertCircle size={13} className="shrink-0 mt-0.5 text-red-400" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-red-200">Error de importación</span>
                  <span>{importError}</span>
                </div>
              </div>
            )}
          </div>

          {/* Real-time Import Progress Bar */}
          {importProgress.active && (
            <div className="flex flex-col gap-1.5 p-2.5 bg-blue-950/30 border border-blue-500/30 rounded text-[10.5px] animate-fade-in shadow-inner">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-blue-300 font-semibold truncate max-w-[170px]" title={importProgress.fileName}>
                  {importProgress.fileName}
                </span>
                <span className="text-blue-400 font-bold text-[11px]">
                  {importProgress.percent}%
                </span>
              </div>
              
              {/* Progress Bar Container */}
              <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden p-0.5 border border-blue-500/20 relative">
                <div 
                  className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                  style={{ width: `${importProgress.percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[9px] text-text-muted">
                <span className="italic truncate max-w-[210px]">{importProgress.stage}</span>
                <span className="font-mono text-blue-400/80">64-bit</span>
              </div>
            </div>
          )}

          {/* Imported List */}
          {importedBodies.length > 0 ? (
            <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto pr-1">
              {importedBodies.map((body) => (
                <div key={body.id} className="flex items-center justify-between bg-black/20 p-2 rounded border border-white/[0.03] text-[11px]">
                  <span className="truncate font-mono text-text-main font-medium max-w-[150px]" title={body.name}>
                    {body.name}
                  </span>
                  <button
                    onClick={() => onDeleteImportedBody?.(body.id)}
                    className="p-1 text-text-muted hover:text-red-400 hover:bg-highlight-subtle rounded transition-all cursor-pointer"
                    title="Eliminar modelo importado"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-text-muted italic text-center py-2 border border-dashed border-border-subtle rounded bg-black/5 leading-snug">
              No hay modelos importados.<br />Sube un archivo para usarlo como base.
            </div>
          )}
        </div>

        {/* Inject Presets Templates */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px]">
            Generador de Perfiles (Presets)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleInjectPreset("nut")}
              className="py-2 px-3 bg-surface-hover hover:bg-highlight-subtle text-text-main border border-border-main rounded text-left flex flex-col gap-0.5 transition-all group cursor-pointer"
            >
              <span className="text-xs font-bold group-hover:text-blue-400">Tuerca Hex</span>
              <span className="text-[9px] text-text-muted font-mono">Hex nut with hole</span>
            </button>
            <button
              onClick={() => handleInjectPreset("washer")}
              className="py-2 px-3 bg-surface-hover hover:bg-highlight-subtle text-text-main border border-border-main rounded text-left flex flex-col gap-0.5 transition-all group cursor-pointer"
            >
              <span className="text-xs font-bold group-hover:text-blue-400">Arandela Circ</span>
              <span className="text-[9px] text-text-muted font-mono">Flat washer donut</span>
            </button>
            <button
              onClick={() => handleInjectPreset("bracket")}
              className="py-2 px-3 bg-surface-hover hover:bg-highlight-subtle text-text-main border border-border-main rounded text-left flex flex-col gap-0.5 transition-all group cursor-pointer"
            >
              <span className="text-xs font-bold group-hover:text-blue-400">Soporte en L</span>
              <span className="text-[9px] text-text-muted font-mono">L-shaped bracket</span>
            </button>
            <button
              onClick={() => handleInjectPreset("star")}
              className="py-2 px-3 bg-surface-hover hover:bg-highlight-subtle text-text-main border border-border-main rounded text-left flex flex-col gap-0.5 transition-all group cursor-pointer"
            >
              <span className="text-xs font-bold group-hover:text-blue-400">Estrella 5P</span>
              <span className="text-[9px] text-text-muted font-mono">5-point star solid</span>
            </button>
          </div>
        </div>

        {/* Dynamic Details box */}
        <div className="bg-panel p-3.5 rounded border border-border-subtle flex flex-col gap-1.5 text-xs text-text-muted">
          <div className="text-[10px] font-bold text-text-main/50 uppercase tracking-[1px] mb-0.5">Propiedades: Geometría Sólida</div>
          <div className="flex justify-between text-[11.5px]">
            <span>Perfiles activos:</span>
            <span className="font-semibold text-text-main">{activeSketch.profiles.length} (Cerrados)</span>
          </div>
          <div className="flex justify-between text-[11.5px]">
            <span>Puntos de Boceto:</span>
            <span className="font-semibold text-text-main">
              {activeSketch.profiles.reduce((acc, p) => acc + p.points.length, 0)}
            </span>
          </div>
          <div className="flex justify-between text-[11.5px]">
            <span>Operación:</span>
            <span className="font-semibold text-blue-400 uppercase text-[11.5px] tracking-wide">{activeOpType}</span>
          </div>
        </div>
      </div>

      {/* Exporter Section */}
      <div className="p-4 bg-panel border-t border-border-main flex flex-col gap-2.5">
        <label className="text-[10px] font-bold text-text-main/40 uppercase tracking-[2px]">
          Exportar Geometría CAD
        </label>
        
        <div className="flex flex-col gap-2 mb-4 border-b border-border-main pb-4">
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5 mb-1">
            <Settings size={11} />
            Proyecto
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onSaveProject}
              className="py-1.5 bg-surface hover:bg-zinc-700 text-text-main hover:text-text-main font-semibold text-[10px] rounded transition-all cursor-pointer border border-border-subtle flex items-center justify-center gap-1"
            >
              <Download size={12} />
              Guardar
            </button>
            <label className="py-1.5 bg-surface hover:bg-zinc-700 text-text-main hover:text-text-main font-semibold text-[10px] rounded transition-all cursor-pointer border border-border-subtle flex items-center justify-center gap-1">
              <Upload size={12} />
              Cargar
              <input type="file" accept=".cadproj,.json" className="hidden" onChange={onLoadProject} />
            </label>
          </div>
        </div>

        {/* Core Export STEP Button */}
        <button
          onClick={onExportSTEP}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-text-main font-extrabold text-xs rounded transition-all duration-150 shadow-[0_4px_12px_rgba(37,99,235,0.255)] cursor-pointer flex items-center justify-center gap-2"
        >
          <FileCode size={14} />
          <span>EXPORTAR .STEP (Formato CAD)</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          {/* Export STL */}
          <button
            onClick={onExportSTL}
            className="py-2.5 bg-[#1a1a1a] hover:bg-highlight-subtle border border-border-main text-text-main font-bold text-xs rounded cursor-pointer transition-colors"
          >
            <span>Descargar .STL</span>
          </button>

          {/* Export OBJ */}
          <button
            onClick={onExportOBJ}
            className="py-2.5 bg-[#1a1a1a] hover:bg-highlight-subtle border border-border-main text-text-main font-bold text-xs rounded cursor-pointer transition-colors"
          >
            <span>Descargar .OBJ</span>
          </button>
        </div>
        
        <p className="text-[9.5px] text-text-muted text-center leading-normal">
          El módulo .STEP compila un modelo analítico B-Rep exacto de curvas y caras, ideal para ingeniería CNC, SolidWorks, FreeCAD o Fusion360.
        </p>
      </div>
    </div>
  );
}

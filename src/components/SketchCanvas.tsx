import React, { useState, useEffect, useRef } from 'react';
import { ProfileType, Point2D, SketchData, PlaneType, Profile, CADOperation } from '../types';
import SketchPropertiesPanel from './SketchPropertiesPanel';
import { getSolidRegions } from '../GeometryUtils';
import { Grid, Magnet, Scissors, Triangle, Circle, Square, MousePointer2, Move, Type, TypeIcon, Scaling, Slash, PenTool, Hexagon, Settings2 } from 'lucide-react';

export type SnapType = 'vertex' | 'midpoint' | 'center' | 'intersection' | 'edge' | 'parallel' | 'perpendicular' | 'grid' | 'none';

export type Guideline = 
  | { type: 'axis'; axis: 'x' | 'y'; value: number }
  | { type: 'angle'; p1: Point2D; p2: Point2D; snapType: 'parallel' | 'perpendicular' };

export interface SnapInfo {
  point: Point2D;
  type: SnapType;
  guides?: Guideline[];
}

export default function SketchCanvas({ 
  theme = "light", activeSketch, onUpdateActiveSketch, axisSelection, onSelectAxisPoint,
  activeRevolveAxis, previousIntersectionSegments, edgeSelectionMode, selectedCorners, onToggleCornerSelection
}: any) {
  const [tool, setTool] = useState<ProfileType | "select" | "line" | "trim">("line");
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{ start: Point2D, current: Point2D } | null>(null);
  const [isSelectingMirrorAxis, setIsSelectingMirrorAxis] = useState(false);
  const [customMirrorCopyState, setCustomMirrorCopyState] = useState(false);
  const [pendingMirrorPoints, setPendingMirrorPoints] = useState<Point2D[]>([]);
  const [osnapSettings, setOsnapSettings] = useState({
    grid: true, vertex: true, midpoint: true, center: true, intersection: true, edge: true, angle: true, guides: true
  });
  const [isOsnapMenuOpen, setIsOsnapMenuOpen] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<{ profileId: string, index: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedProfileIds.length > 0) {
          onUpdateActiveSketch({
            ...activeSketch,
            profiles: activeSketch.profiles.filter((p: any) => !selectedProfileIds.includes(p.id))
          });
          setSelectedProfileIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSketch, selectedProfileIds, onUpdateActiveSketch]);

  const [drawingPoints, setDrawingPoints] = useState<Point2D[]>([]);
  const [trackedPoints, setTrackedPoints] = useState<Point2D[]>([]);
  const [activeSnapType, setActiveSnapType] = useState<SnapType>('none');
  const [hoveredPoint, setHoveredPoint] = useState<Point2D | null>(null);
  const [activeGuides, setActiveGuides] = useState<Guideline[]>([]);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gridSize = 10;
  const [tempEndPoint, setTempEndPoint] = useState<Point2D | null>(null);

  useEffect(() => {
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setPan({ x: rect.width / 2, y: rect.height / 2 });
      }
    }
  }, []);

  const cadToSVG = (pt: Point2D) => {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return { x: 0, y: 0 };
    return { x: pan.x + pt.x * zoom, y: pan.y - pt.y * zoom };
  };
  
  const clientToCAD = (clientX: number, clientY: number): SnapInfo => {
    if (!svgRef.current) return { point: { x: 0, y: 0 }, type: 'none', guides: [] };
    const rect = svgRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const rawCadX = (x - pan.x) / zoom;
    const rawCadY = (pan.y - y) / zoom;

    let bestPointSnap: Point2D | null = null;
    let bestSnapType: SnapType = 'none';
    let minSnapDist = 12 / zoom;

    const testCandidate = (pt: Point2D, type: SnapType) => {
      const dist = Math.hypot(rawCadX - pt.x, rawCadY - pt.y);
      if (dist < minSnapDist) {
        minSnapDist = dist;
        bestPointSnap = pt;
        bestSnapType = type;
      }
    };

    if (activeSketch && activeSketch.profiles) {
      activeSketch.profiles.forEach((profile: any) => {
        if (profile.center && osnapSettings.center) testCandidate(profile.center, 'center');
        if (profile.points) {
          profile.points.forEach((pt: Point2D, i: number) => {
            if (osnapSettings.vertex) testCandidate(pt, 'vertex');
            if (osnapSettings.midpoint && (profile.isClosed || i < profile.points.length - 1)) {
              const nextPt = profile.points[(i + 1) % profile.points.length];
              const midPt = { x: (pt.x + nextPt.x) / 2, y: (pt.y + nextPt.y) / 2 };
              testCandidate(midPt, 'midpoint');
            }
          });
        }
      });
    }

    if (previousIntersectionSegments) {
      previousIntersectionSegments.forEach((seg: { p1: Point2D; p2: Point2D }) => {
        if (osnapSettings.vertex) {
          testCandidate(seg.p1, 'vertex');
          testCandidate(seg.p2, 'vertex');
        }
        if (osnapSettings.midpoint) {
          testCandidate({ x: (seg.p1.x + seg.p2.x) / 2, y: (seg.p1.y + seg.p2.y) / 2 }, 'midpoint');
        }
      });
    }

    if (bestPointSnap) {
      return { point: bestPointSnap, type: bestSnapType, guides: [] };
    }

    let snapX = rawCadX;
    let snapY = rawCadY;
    let type: SnapType = 'none';
    const guides: Guideline[] = [];

    if (osnapSettings.guides) {
      const candidates: Point2D[] = [...drawingPoints];
      candidates.push({ x: 0, y: 0 }); // Origin
      if (activeSketch && activeSketch.profiles) {
        activeSketch.profiles.forEach((p: any) => {
          if (p.center) candidates.push(p.center);
          if (p.points) p.points.forEach((pt: Point2D) => candidates.push(pt));
        });
      }
      if (previousIntersectionSegments) {
        previousIntersectionSegments.forEach((seg: any) => {
          candidates.push(seg.p1);
          candidates.push(seg.p2);
        });
      }

      let bestGuideX: number | null = null;
      let minGuideDistX = 5 / zoom;
      let bestGuideY: number | null = null;
      let minGuideDistY = 5 / zoom;

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

    if (osnapSettings.grid) {
      const gridX = Math.round(snapX / gridSize) * gridSize;
      const gridY = Math.round(snapY / gridSize) * gridSize;
      if (Math.abs(snapX - gridX) < 8 / zoom && Math.abs(snapY - gridY) < 8 / zoom) {
        snapX = gridX;
        snapY = gridY;
        type = 'grid';
      }
    }

    return { point: { x: parseFloat(snapX.toFixed(2)), y: parseFloat(snapY.toFixed(2)) }, type, guides };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsDragging(true);
      return;
    }
    if (e.button !== 0) return; 

    const cadPoint = clientToCAD(e.clientX, e.clientY).point;

    if (axisSelection) {
      onSelectAxisPoint(cadPoint);
      return;
    }

    if (isSelectingMirrorAxis && selectedProfileIds.length >= 1) {
      const newPoints = [...pendingMirrorPoints, cadPoint];
      if (newPoints.length === 1) {
        setPendingMirrorPoints(newPoints);
      } else if (newPoints.length === 2) {
        const p1 = newPoints[0];
        const p2 = newPoints[1];
        
        const profile = activeSketch.profiles.find((p: any) => p.id === selectedProfileIds[0]);
        if (profile) {
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          
          const mirrorPoint = (pt: Point2D) => {
            // Translate point so p1 is origin
            const translatedX = pt.x - p1.x;
            const translatedY = pt.y - p1.y;
            // Rotate so line is horizontal
            const rotX = translatedX * cos + translatedY * sin;
            const rotY = -translatedX * sin + translatedY * cos;
            // Mirror across X (which is now our line)
            const mirroredY = -rotY;
            // Rotate back
            const backX = rotX * cos - mirroredY * sin;
            const backY = rotX * sin + mirroredY * cos;
            // Translate back
            return { x: backX + p1.x, y: backY + p1.y };
          };

          const newPointsArr = profile.points?.map(mirrorPoint);
          const newCenter = profile.center ? mirrorPoint(profile.center) : undefined;
          
          const isMirrorCopy = customMirrorCopyState;
          
          const newProfile = {
            ...profile,
            id: isMirrorCopy ? Math.random().toString(36).substr(2, 9) : profile.id,
            points: newPointsArr,
            center: newCenter
          };

          onUpdateActiveSketch({
            ...activeSketch,
            profiles: isMirrorCopy 
              ? [...activeSketch.profiles, newProfile]
              : activeSketch.profiles.map((p: any) => p.id === profile.id ? newProfile : p)
          });
          if (isMirrorCopy) setSelectedProfileIds([newProfile.id]);
        }
        
        setIsSelectingMirrorAxis(false);
        setPendingMirrorPoints([]);
      }
      return;
    }

    
    if (tool === "select") {
      setSelectionBox({ start: cadPoint, current: cadPoint });
      if (!e.shiftKey && !e.ctrlKey) setSelectedProfileIds([]);
      return;
    }
    if (tool === "line") {
      if (drawingPoints.length > 2) {
        const startPoint = drawingPoints[0];
        const dist = Math.hypot(cadPoint.x - startPoint.x, cadPoint.y - startPoint.y);
        if (dist < 8 / zoom) {
          const newProfile: Profile = {
            id: Math.random().toString(36).substr(2, 9),
            type: "polygon",
            points: [...drawingPoints],
            isClosed: true
          };
          onUpdateActiveSketch({
            ...activeSketch,
            profiles: [...activeSketch.profiles, newProfile]
          });
          setDrawingPoints([]);
          setTempEndPoint(null);
          return;
        }
      }
      setDrawingPoints([...drawingPoints, cadPoint]);
    } 
    else if (tool === "rectangle") {
      if (drawingPoints.length === 0) {
        setDrawingPoints([cadPoint]);
      } else {
        const p1 = drawingPoints[0];
        const p2 = cadPoint;
        const rectPoints: Point2D[] = [
          p1,
          { x: p2.x, y: p1.y },
          p2,
          { x: p1.x, y: p2.y }
        ];
        const newProfile: Profile = {
          id: Math.random().toString(36).substr(2, 9),
          type: "rectangle",
          points: rectPoints,
          isClosed: true
        };
        onUpdateActiveSketch({
          ...activeSketch,
          profiles: [...activeSketch.profiles, newProfile]
        });
        setDrawingPoints([]);
        setTempEndPoint(null);
      }
    }
    else if (tool === "circle") {
      if (drawingPoints.length === 0) {
        setDrawingPoints([cadPoint]);
      } else {
        const center = drawingPoints[0];
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
        onUpdateActiveSketch({
          ...activeSketch,
          profiles: [...activeSketch.profiles, newProfile]
        });
        setDrawingPoints([]);
        setTempEndPoint(null);
      }
    }
    else if (tool === "triangle") {
      if (drawingPoints.length === 0) {
        setDrawingPoints([cadPoint]);
      } else {
        const p1 = drawingPoints[0];
        const p2 = cadPoint;
        const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const points = [
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
        onUpdateActiveSketch({
          ...activeSketch,
          profiles: [...activeSketch.profiles, newProfile]
        });
        setDrawingPoints([]);
        setTempEndPoint(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: pan.x + e.movementX, y: pan.y + e.movementY });
      return;
    }
    const snapInfo = clientToCAD(e.clientX, e.clientY);
    setHoveredPoint(snapInfo.point);
    setActiveSnapType(snapInfo.type);
    setActiveGuides(snapInfo.guides || []);
    
    
    if (tool === "select" && selectionBox) {
      setSelectionBox({ ...selectionBox, current: snapInfo.point });
      return;
    }
    if (drawingPoints.length > 0) {
      setTempEndPoint(snapInfo.point);
    } else {
      setTempEndPoint(null);
    }
  };

  
  const handleMouseUp = (e: React.MouseEvent) => {
    setIsDragging(false);
    if (tool === "select" && selectionBox) {
      if (Math.abs(selectionBox.current.x - selectionBox.start.x) > 0.1 || Math.abs(selectionBox.current.y - selectionBox.start.y) > 0.1) {
        const minX = Math.min(selectionBox.start.x, selectionBox.current.x);
        const maxX = Math.max(selectionBox.start.x, selectionBox.current.x);
        const minY = Math.min(selectionBox.start.y, selectionBox.current.y);
        const maxY = Math.max(selectionBox.start.y, selectionBox.current.y);
        const isLeftToRight = selectionBox.current.x > selectionBox.start.x;
        
        const selectedIds = activeSketch.profiles.filter((p: any) => {
          if (!p.points) return false;
          if (isLeftToRight) {
            return p.points.every((pt: any) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY);
          } else {
            if (p.points.some((pt: any) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY)) return true;
            const pMinX = Math.min(...p.points.map((pt: any) => pt.x));
            const pMaxX = Math.max(...p.points.map((pt: any) => pt.x));
            const pMinY = Math.min(...p.points.map((pt: any) => pt.y));
            const pMaxY = Math.max(...p.points.map((pt: any) => pt.y));
            return (pMinX <= maxX && pMaxX >= minX && pMinY <= maxY && pMaxY >= minY);
          }
        }).map((p: any) => p.id);

        if (e.shiftKey || e.ctrlKey) {
          setSelectedProfileIds(prev => [...new Set([...prev, ...selectedIds])]);
        } else {
          setSelectedProfileIds(selectedIds);
        }
      }
      setSelectionBox(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.max(0.2, Math.min(20, zoom * factor));
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setPan({
        x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
        y: mouseY - (mouseY - pan.y) * (newZoom / zoom)
      });
    }
    setZoom(newZoom);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawingPoints([]);
        setTempEndPoint(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden transition-colors duration-300" style={{ backgroundColor: theme === "dark" ? "#0f172a" : "#f8fafc" }} ref={containerRef}>
      <div className="absolute top-2 left-2 flex flex-col gap-2 z-10">
        <div className="flex flex-wrap gap-1 bg-surface border border-border-subtle p-1 rounded-md shadow-lg">
          <button
            onClick={() => { setTool("select"); setDrawingPoints([]); setTempEndPoint(null); setIsSelectingMirrorAxis(false); setPendingMirrorPoints([]); }}
            className={`p-2 rounded flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer \${
              tool === "select" ? "bg-surface-hover text-blue-400 border border-border-subtle" : "text-text-muted hover:text-text-muted border border-transparent hover:border-border-subtle hover:bg-surface-hover"
            }`}
            title="Seleccionar (S)"
          >
            <MousePointer2 size={14} />
            Seleccionar
          </button>
          <button
            onClick={() => setTool("line")}
            className={`p-2 rounded flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer ${
              tool === "line" ? "bg-surface-hover text-blue-400 border border-border-subtle" : "text-text-muted hover:text-text-muted border border-transparent hover:border-border-subtle hover:bg-surface-hover"
            }`}
            title="Línea (L)"
          >
            <PenTool size={14} />
            Línea
          </button>
          <button
            onClick={() => setTool("rectangle")}
            className={`p-2 rounded flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer ${
              tool === "rectangle" ? "bg-surface-hover text-blue-400 border border-border-subtle" : "text-text-muted hover:text-text-muted border border-transparent hover:border-border-subtle hover:bg-surface-hover"
            }`}
            title="Rectángulo (R)"
          >
            <Square size={14} />
            Rectángulo
          </button>
          <button
            onClick={() => setTool("circle")}
            className={`p-2 rounded flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer ${
              tool === "circle" ? "bg-surface-hover text-blue-400 border border-border-subtle" : "text-text-muted hover:text-text-muted border border-transparent hover:border-border-subtle hover:bg-surface-hover"
            }`}
            title="Círculo (C)"
          >
            <Circle size={14} />
            Círculo
          </button>
          <button
            onClick={() => setTool("triangle")}
            className={`p-2 rounded flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer ${
              tool === "triangle" ? "bg-surface-hover text-blue-400 border border-border-subtle" : "text-text-muted hover:text-text-muted border border-transparent hover:border-border-subtle hover:bg-surface-hover"
            }`}
            title="Triángulo Equilátero"
          >
            <Triangle size={14} />
            Triángulo
          </button>
          <button
            onClick={() => setTool("trim")}
            className={`p-2 rounded flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer ${
              tool === "trim" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "text-text-muted hover:text-red-400 border border-transparent hover:border-red-500/20 hover:bg-red-500/10"
            }`}
            title="Recortar / Eliminar Segmento"
          >
            <Scissors size={14} />
            Recortar
          </button>
        </div>
      </div>

      {tool === "select" && selectedProfileIds.length >= 1 && !isSelectingMirrorAxis && (
        <SketchPropertiesPanel 
          activeSketch={activeSketch}
          selectedProfileIdsList={selectedProfileIds}
          setSelectedProfileIds={setSelectedProfileIds}
          onUpdateActiveSketch={onUpdateActiveSketch}
          onClose={() => setSelectedProfileIds([])}
          onStartCustomMirror={(isCopy: boolean) => {
             setCustomMirrorCopyState(isCopy);
             setIsSelectingMirrorAxis(true);
          }}
        />
      )}
      
      {isSelectingMirrorAxis && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-blue-500/20 text-blue-400 border border-blue-500/30 px-4 py-2 rounded-full text-sm font-semibold shadow-lg z-20 pointer-events-none">
          Paso {pendingMirrorPoints.length + 1} de 2: Haz clic para definir el {pendingMirrorPoints.length === 0 ? "primer" : "segundo"} punto del eje de simetría
        </div>
      )}

      <svg 
        ref={svgRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsDragging(false);
          setActiveGuides([]);
          setHoveredPoint(null);
        }}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid-minor" width={gridSize * zoom} height={gridSize * zoom} patternUnits="userSpaceOnUse" patternTransform={`translate(${pan.x % (gridSize * zoom)}, ${pan.y % (gridSize * zoom)})`}>
            <path d={`M ${gridSize * zoom} 0 L 0 0 0 ${gridSize * zoom}`} fill="none" stroke={theme === "dark" ? "#1e293b" : "#e2e8f0"} strokeWidth="0.75" />
          </pattern>
          <pattern id="grid-major" width={gridSize * 5 * zoom} height={gridSize * 5 * zoom} patternUnits="userSpaceOnUse" patternTransform={`translate(${pan.x % (gridSize * 5 * zoom)}, ${pan.y % (gridSize * 5 * zoom)})`}>
            <rect width={gridSize * 5 * zoom} height={gridSize * 5 * zoom} fill="url(#grid-minor)" />
            <path d={`M ${gridSize * 5 * zoom} 0 L 0 0 0 ${gridSize * 5 * zoom}`} fill="none" stroke={theme === "dark" ? "#334155" : "#cbd5e1"} strokeWidth="1.25" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-major)" pointerEvents="none" opacity="0.95" />
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
           <rect x="-10000" y="-10000" width="20000" height="20000" fill="none" pointerEvents="all" />
        </g>
        <g id="axes-layer" className="pointer-events-none">
          {/* Eje X (Rojo) */}
          <line x1={0} y1={pan.y} x2={20000} y2={pan.y} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.75" />
          <line x1={-20000} y1={pan.y} x2={0} y2={pan.y} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.75" />
          {/* Eje Y (Verde) */}
          <line x1={pan.x} y1={0} x2={pan.x} y2={20000} stroke="#22c55e" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.75" />
          <line x1={pan.x} y1={-20000} x2={pan.x} y2={0} stroke="#22c55e" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.75" />
          {/* Centro / Origen */}
          <circle cx={pan.x} cy={pan.y} r="5" fill="#2563eb" opacity="0.9" />
          <circle cx={pan.x} cy={pan.y} r="2" fill="#ffffff" />
        </g>
        <g id="osnap-layer" className="pointer-events-none">
          {activeGuides.map((g, i) => {
            if (g.type === 'axis') {
              if (g.axis === 'x') {
                const svgX = cadToSVG({ x: g.value, y: 0 }).x;
                return <line key={`guide-x-${i}`} x1={svgX} y1="-10000" x2={svgX} y2="10000" stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,5" />;
              } else {
                const svgY = cadToSVG({ x: 0, y: g.value }).y;
                return <line key={`guide-y-\${i}`} x1="-10000" y1={svgY} x2="10000" y2={svgY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,5" />;
              }
            } else if (g.type === 'angle') {
              const svgP1 = cadToSVG(g.p1);
              const angle = Math.atan2(g.p2.y - g.p1.y, g.p2.x - g.p1.x); // CAD angle
              const svgAngle = -angle;
              const dx = 10000 * Math.cos(svgAngle);
              const dy = 10000 * Math.sin(svgAngle);
              return <line key={`guide-angle-\${i}`} x1={svgP1.x - dx} y1={svgP1.y - dy} x2={svgP1.x + dx} y2={svgP1.y + dy} stroke={g.snapType === 'parallel' ? "#10b981" : "#ec4899"} strokeWidth="1" strokeDasharray="5,5" />;
            }
            return null;
          })}
          {hoveredPoint && activeSnapType !== 'none' && (
            <g transform={`translate(${cadToSVG(hoveredPoint).x}, ${cadToSVG(hoveredPoint).y})`}>
              {activeSnapType === 'vertex' && (
                <rect x="-5" y="-5" width="10" height="10" fill="none" stroke="#f59e0b" strokeWidth="2" />
              )}
              {activeSnapType === 'midpoint' && (
                <polygon points="0,-6 5.2,3 -5.2,3" fill="none" stroke="#06b6d4" strokeWidth="2" />
              )}
              {activeSnapType === 'center' && (
                <circle cx="0" cy="0" r="5" fill="none" stroke="#22c55e" strokeWidth="2" />
              )}
              {activeSnapType === 'intersection' && (
                <path d="M-5,-5 L5,5 M-5,5 L5,-5" fill="none" stroke="#ef4444" strokeWidth="2" />
              )}
              {activeSnapType === 'grid' && (
                <circle cx="0" cy="0" r="3" fill="#3b82f6" />
              )}
            </g>
          )}
        </g>
        <g id="active-draw-layer">
            {pendingMirrorPoints.length > 0 && isSelectingMirrorAxis && (
              <>
                <circle cx={cadToSVG(pendingMirrorPoints[0]).x} cy={cadToSVG(pendingMirrorPoints[0]).y} r="5" fill="#f43f5e" />
                {tempEndPoint && (
                  <line 
                    x1={cadToSVG(pendingMirrorPoints[0]).x} y1={cadToSVG(pendingMirrorPoints[0]).y}
                    x2={cadToSVG(tempEndPoint).x} y2={cadToSVG(tempEndPoint).y}
                    stroke="#f43f5e" strokeWidth="2" strokeDasharray="4,4"
                  />
                )}
              </>
            )}
            {drawingPoints.length > 0 && !isSelectingMirrorAxis && (
              <>
                {/* LINE PREVIEW */}
                {tool === "line" && (
                  <>
                    {drawingPoints.map((pt, i) => {
                      if (i === 0) return null;
                      const prevSvg = cadToSVG(drawingPoints[i - 1]);
                      const currSvg = cadToSVG(pt);
                      return (
                        <line
                          key={`draw-line-${i}`}
                          x1={prevSvg.x} y1={prevSvg.y} x2={currSvg.x} y2={currSvg.y}
                          stroke="#60a5fa" strokeWidth="2.2" strokeDasharray="2,2"
                        />
                      );
                    })}
                    {tempEndPoint && (
                      <g>
                        <line
                          x1={cadToSVG(drawingPoints[drawingPoints.length - 1]).x}
                          y1={cadToSVG(drawingPoints[drawingPoints.length - 1]).y}
                          x2={cadToSVG(tempEndPoint).x}
                          y2={cadToSVG(tempEndPoint).y}
                          stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,4"
                        />
                        {(() => {
                          const pLast = drawingPoints[drawingPoints.length - 1];
                          const dx = tempEndPoint.x - pLast.x;
                          const dy = tempEndPoint.y - pLast.y;
                          const length = Math.hypot(dx, dy);
                          
                          let angleStr = "";
                          if (drawingPoints.length >= 2) {
                            const pPrev = drawingPoints[drawingPoints.length - 2];
                            const a1 = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
                            const a2 = Math.atan2(dy, dx);
                            let diff = (a2 - a1) * 180 / Math.PI;
                            while (diff < -180) diff += 360;
                            while (diff > 180) diff -= 360;
                            angleStr = `, ${Math.abs(diff).toFixed(1)}°`;
                          } else {
                            let a = Math.atan2(dy, dx) * 180 / Math.PI;
                            while(a < 0) a += 360;
                            angleStr = `, ${a.toFixed(1)}°`;
                          }
                          
                          const svgMid = {
                            x: (cadToSVG(pLast).x + cadToSVG(tempEndPoint).x) / 2,
                            y: (cadToSVG(pLast).y + cadToSVG(tempEndPoint).y) / 2
                          };
                          return (
                            <text
                              x={svgMid.x} y={svgMid.y - 10}
                              fill="#3b82f6" fontSize="10" textAnchor="middle"
                              className="font-mono pointer-events-none"
                              style={{ textShadow: "1px 1px 2px #0f172a, -1px -1px 2px #0f172a, 1px -1px 2px #0f172a, -1px 1px 2px #0f172a" }}
                            >
                              {length.toFixed(1)}mm{angleStr}
                            </text>
                          );
                        })()}
                      </g>
                    )}
                  </>
                )}

                {/* RECTANGLE PREVIEW */}
                {tool === "rectangle" && tempEndPoint && (
                  <polygon
                    points={`${cadToSVG(drawingPoints[0]).x},${cadToSVG(drawingPoints[0]).y} ${cadToSVG({x: tempEndPoint.x, y: drawingPoints[0].y}).x},${cadToSVG({x: tempEndPoint.x, y: drawingPoints[0].y}).y} ${cadToSVG(tempEndPoint).x},${cadToSVG(tempEndPoint).y} ${cadToSVG({x: drawingPoints[0].x, y: tempEndPoint.y}).x},${cadToSVG({x: drawingPoints[0].x, y: tempEndPoint.y}).y}`}
                    fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,4"
                  />
                )}

                {/* CIRCLE PREVIEW */}
                {tool === "circle" && tempEndPoint && (
                  <circle
                    cx={cadToSVG(drawingPoints[0]).x} cy={cadToSVG(drawingPoints[0]).y}
                    r={Math.hypot(tempEndPoint.x - drawingPoints[0].x, tempEndPoint.y - drawingPoints[0].y) * zoom}
                    fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,4"
                  />
                )}

                {/* TRIANGLE PREVIEW */}
                {tool === "triangle" && tempEndPoint && (() => {
                  const p1 = drawingPoints[0];
                  const p2 = tempEndPoint;
                  const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                  const triPoints = [
                    cadToSVG({ x: p1.x + radius * Math.cos(angle), y: p1.y + radius * Math.sin(angle) }),
                    cadToSVG({ x: p1.x + radius * Math.cos(angle + (Math.PI * 2) / 3), y: p1.y + radius * Math.sin(angle + (Math.PI * 2) / 3) }),
                    cadToSVG({ x: p1.x + radius * Math.cos(angle + 2 * (Math.PI * 2) / 3), y: p1.y + radius * Math.sin(angle + 2 * (Math.PI * 2) / 3) })
                  ];
                  return (
                    <polygon
                      points={`${triPoints[0].x},${triPoints[0].y} ${triPoints[1].x},${triPoints[1].y} ${triPoints[2].x},${triPoints[2].y}`}
                      fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,4"
                    />
                  );
                })()}

                {drawingPoints.map((pt, i) => {
                  const svgPt = cadToSVG(pt);
                  const isStart = i === 0;
                  return (
                    <circle
                      key={`active-node-${i}`}
                      cx={svgPt.x}
                      cy={svgPt.y}
                      r={isStart ? 6 : 4}
                      fill={isStart ? "#10b981" : "#3b82f6"}
                      stroke="#121212"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </>
            )}
        </g>
        <g id="profiles-layer">
          {/* Solid Regions Fill (with holes!) */}
          {(() => {
            const profileToPathString = (p: Profile) => {
              if (p.type === 'circle') {
                const c = cadToSVG(p.center!);
                const r = p.radius! * zoom;
                return `M ${c.x - r},${c.y} A ${r},${r} 0 1,0 ${c.x + r},${c.y} A ${r},${r} 0 1,0 ${c.x - r},${c.y}`;
              } else {
                if (!p.points || p.points.length === 0) return "";
                const pts = p.points.map((pt, i) => {
                  const svgPt = cadToSVG(pt);
                  return `${i===0?'M':'L'} ${svgPt.x},${svgPt.y}`;
                }).join(' ');
                return pts + (p.isClosed ? " Z" : "");
              }
            };
            const regions = getSolidRegions(activeSketch);
            return regions.map((region: any, i: number) => {
               const outerPath = profileToPathString(region.outerProfile);
               const holesPath = region.holeProfiles.map((h: any) => profileToPathString(h)).join(' ');
               return <path key={`region-${i}`} d={`${outerPath} ${holesPath}`} fill={theme === "dark" ? "rgba(59, 130, 246, 0.15)" : "rgba(37, 99, 235, 0.12)"} fillRule="evenodd" pointerEvents="none" />;
            });
          })()}

          {/* Reference Geometry from 3D Intersections */}
          {previousIntersectionSegments?.map((seg: any, i: number) => {
            const svgP1 = cadToSVG(seg.p1);
            const svgP2 = cadToSVG(seg.p2);
            return (
              <line 
                key={`ref-seg-${i}`} 
                x1={svgP1.x} y1={svgP1.y} x2={svgP2.x} y2={svgP2.y} 
                stroke="#a855f7" strokeWidth="2" strokeDasharray="4,4" opacity="0.4" 
              />
            );
          })}
          
          {activeSketch?.profiles?.map((p: any) => {
            const isSelected = selectedProfileIds.includes(p.id);
            // Transparent fill for interactive shapes, the region fill is drawn below.
            const defaultFill = "transparent";

            if (p.type === 'circle') {
               const svgCenter = cadToSVG(p.center);
               return <circle 
                 key={p.id} cx={svgCenter.x} cy={svgCenter.y} r={p.radius * zoom} 
                 fill={isSelected ? "rgba(37, 99, 235, 0.18)" : defaultFill}
                 stroke={isSelected ? "#2563eb" : (theme === "dark" ? "#f8fafc" : "#1e293b")} 
                 strokeWidth={isSelected ? "2.5" : "2"} 
                 className={tool === "select" ? "cursor-pointer hover:stroke-blue-400" : ""}
                 pointerEvents={tool === "select" ? "all" : "stroke"}
                 onMouseDown={(e) => {
                   if (tool === "select") { 
    e.stopPropagation(); 
    setSelectedProfileIds(prev => (e.shiftKey || e.ctrlKey) ? (prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]) : [p.id]); 
  }
                 }}
               />;
            }
            if (!p.points || p.points.length === 0) return null;
            const pts = p.points.map((pt: any) => {
              const svgPt = cadToSVG(pt);
              return `${svgPt.x},${svgPt.y}`;
            }).join(' ');
            return (
               <polygon 
                 key={p.id} points={pts} 
                 fill={isSelected ? "rgba(37, 99, 235, 0.18)" : defaultFill} 
                 stroke={isSelected ? "#2563eb" : (theme === "dark" ? "#f8fafc" : "#1e293b")} 
                 strokeWidth={isSelected ? "2.5" : "2"} 
                 className={tool === "select" ? "cursor-pointer hover:stroke-blue-400" : ""}
                 pointerEvents={tool === "select" ? "all" : "stroke"}
                 onMouseDown={(e) => {
                   if (tool === "select") { 
    e.stopPropagation(); 
    setSelectedProfileIds(prev => (e.shiftKey || e.ctrlKey) ? (prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]) : [p.id]); 
  }
                 }}
               />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

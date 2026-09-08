import React, { useState } from 'react';
import { Point2D, Profile } from '../types';
import { Settings2, Slash, Trash2, Copy, Move, Maximize2, CircleDashed, FlipHorizontal, Sparkles, X } from 'lucide-react';

export default function SketchPropertiesPanel({ 
  activeSketch, 
  selectedProfileIdsList, 
  onUpdateActiveSketch, 
  onClose,
  onStartCustomMirror,
  setSelectedProfileIds,
  onExtrudeProfile,
  className
}: any) {
  const [mirrorCopy, setMirrorCopy] = useState(false);
  const [moveCopy, setMoveCopy] = useState(false);
  const [applyToPattern, setApplyToPattern] = useState(true);
  
  const [dx, setDx] = useState<number>(10);
  const [dy, setDy] = useState<number>(0);
  
  const [linearCountX, setLinearCountX] = useState<number>(3);
  const [linearCountY, setLinearCountY] = useState<number>(1);
  const [linearDx, setLinearDx] = useState<number>(10);
  const [linearDy, setLinearDy] = useState<number>(10);
  
  const [circularCount, setCircularCount] = useState<number>(4);
  const [circularAngle, setCircularAngle] = useState<number>(360);
  
  const profiles = activeSketch?.profiles?.filter((p: any) => selectedProfileIdsList?.includes(p.id));
  if (!profiles || profiles.length === 0) return null;
  const profile = profiles[0];

  const updateProfile = (updated: any, updateGroup: boolean = false) => {
    let updatedProfiles = activeSketch.profiles.map((p: any) => p.id === updated.id ? updated : p);
    
    if (updateGroup && updated.patternGroupId) {
      updatedProfiles = updatedProfiles.map((p: any) => {
        if (p.patternGroupId === updated.patternGroupId && p.id !== updated.id && p.type === updated.type) {
          if (updated.type === "circle" && updated.radius && p.center) {
             const points: Point2D[] = [];
             for (let i = 0; i < 36; i++) {
               const angle = (i / 36) * Math.PI * 2;
               points.push({
                 x: p.center.x + Math.cos(angle) * updated.radius,
                 y: p.center.y + Math.sin(angle) * updated.radius
               });
             }
             return { ...p, radius: updated.radius, points };
          }
        }
        return p;
      });
    }
    
    onUpdateActiveSketch({ ...activeSketch, profiles: updatedProfiles });
  };

  const handleUpdateCircleRadii = (newRadius: number) => {
    if (isNaN(newRadius) || newRadius <= 0) return;
    
    let updatedProfiles = activeSketch.profiles.map((p: any) => {
      // Direct selection
      const isSelected = selectedProfileIdsList.includes(p.id);
      
      // Pattern group matching
      const belongsToPatternGroup = applyToPattern && p.patternGroupId && profiles.some(sel => sel.type === "circle" && sel.patternGroupId === p.patternGroupId);

      if ((isSelected || belongsToPatternGroup) && p.type === "circle" && p.center) {
        const points: Point2D[] = [];
        for (let i = 0; i < 36; i++) {
          const angle = (i / 36) * Math.PI * 2;
          points.push({
            x: p.center.x + Math.cos(angle) * newRadius,
            y: p.center.y + Math.sin(angle) * newRadius
          });
        }
        return { ...p, radius: newRadius, points };
      }
      return p;
    });
    
    onUpdateActiveSketch({ ...activeSketch, profiles: updatedProfiles });
  };

  const addProfiles = (newProfiles: any[]) => {
    onUpdateActiveSketch({
      ...activeSketch,
      profiles: [...activeSketch.profiles, ...newProfiles]
    });
  };

  const deleteProfile = () => {
    onUpdateActiveSketch({
      ...activeSketch,
      profiles: activeSketch.profiles.filter((p: any) => !selectedProfileIdsList.includes(p.id))
    });
    onClose();
  };

  // Move
  const handleMove = () => {
    if (moveCopy) {
      const copies = profiles.map((p:any) => {
        const newPoints = p.points?.map((pt: Point2D) => ({ x: pt.x + dx, y: pt.y + dy }));
        const newCenter = p.center ? { x: p.center.x + dx, y: p.center.y + dy } : undefined;
        return { ...p, id: Math.random().toString(36).substr(2, 9), points: newPoints, center: newCenter };
      });
      addProfiles(copies);
    } else {
      const moved = activeSketch.profiles.map((p:any) => {
        if (selectedProfileIdsList.includes(p.id)) {
          const newPoints = p.points?.map((pt: Point2D) => ({ x: pt.x + dx, y: pt.y + dy }));
          const newCenter = p.center ? { x: p.center.x + dx, y: p.center.y + dy } : undefined;
          return { ...p, points: newPoints, center: newCenter };
        }
        return p;
      });
      onUpdateActiveSketch({ ...activeSketch, profiles: moved });
    }
  };

  // Linear Pattern
  const handleLinearPattern = () => {
    const newProfiles: any[] = [];
    const countX = Math.max(1, linearCountX);
    const countY = Math.max(1, linearCountY);
    
    const groupId = Math.random().toString(36).substr(2, 9);
    
    const updatedSketch = activeSketch.profiles.map((p:any) => {
       if (selectedProfileIdsList.includes(p.id) && !p.patternGroupId) {
         return { ...p, patternGroupId: groupId };
       }
       return p;
    });
    
    const baseProfiles = updatedSketch.filter((p:any) => selectedProfileIdsList.includes(p.id));

    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countY; j++) {
        if (i === 0 && j === 0) continue; // Skip original
        
        const offsetX = linearDx * i;
        const offsetY = linearDy * j;
        
        for (const p of baseProfiles) {
          const newPoints = p.points?.map((pt: Point2D) => ({ x: pt.x + offsetX, y: pt.y + offsetY }));
          const newCenter = p.center ? { x: p.center.x + offsetX, y: p.center.y + offsetY } : undefined;
          newProfiles.push({ ...p, id: Math.random().toString(36).substr(2, 9), points: newPoints, center: newCenter, patternGroupId: p.patternGroupId || groupId });
        }
      }
    }
    onUpdateActiveSketch({
      ...activeSketch,
      profiles: [...updatedSketch, ...newProfiles]
    });
  };

  // Circular Pattern
  const handleCircularPattern = () => {
    const newProfiles: any[] = [];
    const groupId = Math.random().toString(36).substr(2, 9);
    
    const updatedSketch = activeSketch.profiles.map((p:any) => {
       if (selectedProfileIdsList.includes(p.id) && !p.patternGroupId) {
         return { ...p, patternGroupId: groupId };
       }
       return p;
    });
    
    const baseProfiles = updatedSketch.filter((p:any) => selectedProfileIdsList.includes(p.id));

    for (let i = 1; i < circularCount; i++) {
      const angleRad = ((circularAngle / circularCount) * i * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      
      const rotate = (pt: Point2D) => ({
        x: pt.x * cos - pt.y * sin,
        y: pt.x * sin + pt.y * cos
      });

      for (const p of baseProfiles) {
        const newPoints = p.points?.map(rotate);
        const newCenter = p.center ? rotate(p.center) : undefined;
        newProfiles.push({ ...p, id: Math.random().toString(36).substr(2, 9), points: newPoints, center: newCenter, patternGroupId: p.patternGroupId || groupId });
      }
    }
    
    onUpdateActiveSketch({
      ...activeSketch,
      profiles: [...updatedSketch, ...newProfiles]
    });
  };

  // Mirror
  const handleMirror = (axis: 'x' | 'y') => {
    if (mirrorCopy) {
      const copies = profiles.map((p:any) => {
        const newPoints = p.points?.map((pt: Point2D) => ({
          x: axis === 'x' ? pt.x : -pt.x,
          y: axis === 'y' ? pt.y : -pt.y
        }));
        const newCenter = p.center ? {
          x: axis === 'x' ? p.center.x : -p.center.x,
          y: axis === 'y' ? p.center.y : -p.center.y
        } : undefined;
        return { ...p, id: Math.random().toString(36).substr(2, 9), points: newPoints, center: newCenter };
      });
      addProfiles(copies);
    } else {
      const mirrored = activeSketch.profiles.map((p:any) => {
        if (selectedProfileIdsList.includes(p.id)) {
          const newPoints = p.points?.map((pt: Point2D) => ({
            x: axis === 'x' ? pt.x : -pt.x,
            y: axis === 'y' ? pt.y : -pt.y
          }));
          const newCenter = p.center ? {
            x: axis === 'x' ? p.center.x : -p.center.x,
            y: axis === 'y' ? p.center.y : -p.center.y
          } : undefined;
          return { ...p, points: newPoints, center: newCenter };
        }
        return p;
      });
      onUpdateActiveSketch({ ...activeSketch, profiles: mirrored });
    }
  };

  const handleVertexChange = (index: number, axis: 'x'|'y', val: number) => {
    if (isNaN(val)) return;
    const newPoints = [...profile.points];
    newPoints[index] = { ...newPoints[index], [axis]: val };
    updateProfile({ ...profile, points: newPoints });
  };

  const SectionHeader = ({ title, icon: Icon }: any) => (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 border-b border-white/10 pb-1 mb-2 mt-4 first:mt-0">
      <Icon size={12} className="text-blue-400" /> {title}
    </div>
  );

  return (
    <div className={className || "absolute top-4 right-4 w-72 bg-[#121214]/95 backdrop-blur-md border border-blue-500/40 rounded-xl shadow-[0_10px_35px_rgba(0,0,0,0.6)] flex flex-col pointer-events-auto z-20 max-h-[85%] overflow-y-auto custom-scrollbar animate-fadeIn"}>
      <div className="flex justify-between items-center p-3 border-b border-border-subtle/60 bg-black/40 sticky top-0 z-10">
        <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5 uppercase tracking-wider">
          <Settings2 size={15} className="text-blue-400" /> {profiles.length > 1 ? `Propiedades (${profiles.length})` : "Propiedades de Figura"}
        </span>
        <button 
          onClick={onClose} 
          className="text-text-muted hover:text-white p-1 hover:bg-white/10 rounded transition-colors cursor-pointer"
          title="Cerrar panel de propiedades"
        >
          <X size={14} />
        </button>
      </div>
      
      <div className="p-3 flex flex-col gap-1">
        {/* Extruir Directamente */}
        {onExtrudeProfile && (
          <button
            type="button"
            onClick={() => onExtrudeProfile(profile.id)}
            className="w-full flex justify-center items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black shadow-[0_2px_10px_rgba(245,158,11,0.3)] hover:shadow-amber-500/30 transition-all active:scale-95 cursor-pointer mb-2 border border-amber-400/60"
            title="Extruir directamente esta figura seleccionada a sólido 3D"
          >
            <Sparkles size={14} className="text-black stroke-[2.5]" />
            <span>⚡ Extruir Figura a 3D</span>
          </button>
        )}

        {/* Eliminar */}
        <button onClick={deleteProfile} className="w-full flex justify-center items-center gap-2 p-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all cursor-pointer mb-2">
          <Trash2 size={14} /> Eliminar Figura
        </button>

        {/* Radio de Círculo */}
        {profiles.some((p: any) => p.type === "circle") && (() => {
          const circleProf = profiles.find((p: any) => p.type === "circle");
          const rad = circleProf?.radius || 0;
          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title={profiles.filter((p:any) => p.type==="circle").length > 1 ? "Radio (Círculos Seleccionados)" : "Dimensiones del Círculo"} icon={Settings2} />
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Radio (R):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={rad}
                      onChange={(e) => handleUpdateCircleRadii(parseFloat(e.target.value))}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="0.5"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono border-t border-white/5 pt-1">
                  <span>Diámetro (Ø):</span>
                  <span className="text-emerald-400 font-bold font-mono">{(rad * 2).toFixed(2)} mm</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none pt-0.5">
                  <input type="checkbox" checked={applyToPattern} onChange={(e) => setApplyToPattern(e.target.checked)} className="accent-blue-500 rounded" />
                  <span className="text-[10px]">Propagar a toda la matriz</span>
                </label>
              </div>
            </div>
          );
        })()}

        {/* Coordenadas */}
        {profiles.length === 1 && <SectionHeader title="Coordenadas (Vértices)" icon={Move} />}
        {profiles.length === 1 && <div className="flex flex-col gap-1 max-h-32 overflow-y-auto custom-scrollbar pr-1 mb-2">
          {profile.points?.map((pt: Point2D, i: number) => (
            <div key={i} className="flex items-center justify-between text-[10px] bg-black/20 p-1 rounded">
              <span className="text-zinc-500 w-4">V{i}</span>
              <div className="flex gap-1">
                <div className="flex items-center bg-black/40 rounded px-1 border border-white/10">
                  <span className="text-red-400 mr-1">X</span>
                  <input type="number" value={pt.x} onChange={(e) => handleVertexChange(i, 'x', parseFloat(e.target.value))} className="w-10 bg-transparent text-white outline-none text-right" step="1"/>
                </div>
                <div className="flex items-center bg-black/40 rounded px-1 border border-white/10">
                  <span className="text-green-400 mr-1">Y</span>
                  <input type="number" value={pt.y} onChange={(e) => handleVertexChange(i, 'y', parseFloat(e.target.value))} className="w-10 bg-transparent text-white outline-none text-right" step="1"/>
                </div>
              </div>
            </div>
          ))}
        </div>}

        {/* Desplazar */}
        <SectionHeader title="Desplazar / Copiar" icon={Copy} />
        <div className="flex flex-col gap-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none">
            <input type="checkbox" checked={moveCopy} onChange={(e) => setMoveCopy(e.target.checked)} className="accent-blue-500" />
            <span>Conservar original (Copiar)</span>
          </label>
          <div className="flex gap-2">
            <input type="number" placeholder="dX" value={dx} onChange={(e) => setDx(parseFloat(e.target.value))} className="w-full bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
            <input type="number" placeholder="dY" value={dy} onChange={(e) => setDy(parseFloat(e.target.value))} className="w-full bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
            <button onClick={handleMove} className="bg-blue-600 hover:bg-blue-500 text-white rounded px-2 cursor-pointer font-bold">Aplicar</button>
          </div>
        </div>

        {/* Simetría */}
        <SectionHeader title="Simetría (Espejo)" icon={FlipHorizontal} />
        <div className="flex flex-col gap-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none">
            <input type="checkbox" checked={mirrorCopy} onChange={(e) => setMirrorCopy(e.target.checked)} className="accent-blue-500" />
            <span>Conservar original</span>
          </label>
          <div className="flex gap-2">
            <button onClick={() => handleMirror('y')} className="flex-1 p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-zinc-300 hover:text-white">Reflejar Eje X</button>
            <button onClick={() => handleMirror('x')} className="flex-1 p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-zinc-300 hover:text-white">Reflejar Eje Y</button>
          </div>
          <button onClick={() => onStartCustomMirror?.(mirrorCopy)} className="w-full p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded font-bold text-center cursor-pointer border border-blue-500/20 transition-all mt-1 flex items-center justify-center gap-1.5">
            <Slash size={12} className="rotate-90" /> Definir Eje en Pantalla
          </button>
        </div>

        {/* Matriz Lineal */}
        <SectionHeader title="Matriz Lineal" icon={Maximize2} />
        <div className="flex flex-col gap-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400 w-8">Eje X:</span>
            <div className="flex gap-1 items-center flex-1">
              <input type="number" value={linearCountX} onChange={(e) => setLinearCountX(parseInt(e.target.value))} min="1" className="w-10 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Copias en X" />
              <span className="text-zinc-500">x</span>
              <input type="number" value={linearDx} onChange={(e) => setLinearDx(parseFloat(e.target.value))} className="w-full bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Distancia X" />
              <span className="text-zinc-500">mm</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400 w-8">Eje Y:</span>
            <div className="flex gap-1 items-center flex-1">
              <input type="number" value={linearCountY} onChange={(e) => setLinearCountY(parseInt(e.target.value))} min="1" className="w-10 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Copias en Y" />
              <span className="text-zinc-500">x</span>
              <input type="number" value={linearDy} onChange={(e) => setLinearDy(parseFloat(e.target.value))} className="w-full bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Distancia Y" />
              <span className="text-zinc-500">mm</span>
            </div>
          </div>
          <button onClick={handleLinearPattern} className="w-full p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-blue-400 hover:text-blue-300 mt-1">Generar Matriz 2D</button>
        </div>

        {/* Matriz Circular */}
        <SectionHeader title="Matriz Circular" icon={CircleDashed} />
        <div className="flex flex-col gap-2 text-[11px] mb-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Copias totales:</span>
            <input type="number" value={circularCount} onChange={(e) => setCircularCount(parseInt(e.target.value))} min="2" className="w-12 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-zinc-400 flex-1">Ángulo total (°):</span>
            <input type="number" value={circularAngle} onChange={(e) => setCircularAngle(parseFloat(e.target.value))} className="w-16 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
          </div>
          <button onClick={handleCircularPattern} className="w-full p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-blue-400 hover:text-blue-300 mt-1">Generar Matriz (Origen)</button>
        </div>
      </div>
    </div>
  );
}

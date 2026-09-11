import React, { useEffect, useState } from 'react';
import { Point2D, Profile } from '../types';
import MeasurementInput, { formatMeasurement } from './MeasurementInput';
import { Settings2, Slash, Trash2, Copy, Move, Maximize2, CircleDashed, FlipHorizontal, Sparkles, X, Square, Triangle, Hexagon, PenTool, Ruler } from 'lucide-react';

export default function SketchPropertiesPanel({ 
  activeSketch, 
  selectedProfileIdsList, 
  onUpdateActiveSketch, 
  onClose,
  onStartCustomMirror,
  setSelectedProfileIds,
  onExtrudeProfile,
  className,
  showProfileList = false,
  expandRevision = 0
}: any) {
  const [collapsed, setCollapsed] = useState(false);
  const selectionKey = (selectedProfileIdsList || []).join(',');
  useEffect(() => setCollapsed(false), [activeSketch?.id, selectionKey, expandRevision]);
  useEffect(() => {
    if (showProfileList && activeSketch?.profiles?.length && (!selectedProfileIdsList || selectedProfileIdsList.length === 0)) {
      setSelectedProfileIds?.([activeSketch.profiles[activeSketch.profiles.length - 1].id]);
    }
  }, [activeSketch?.id, activeSketch?.profiles?.length, showProfileList]);
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
  if (!activeSketch || (!showProfileList && !profiles?.length)) return null;
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

      if ((isSelected || belongsToPatternGroup) && p.type === "circle") {
        const pCenter = p.center || (p.points?.length ? {
          x: p.points.reduce((acc: number, pt: Point2D) => acc + pt.x, 0) / p.points.length,
          y: p.points.reduce((acc: number, pt: Point2D) => acc + pt.y, 0) / p.points.length,
        } : { x: 0, y: 0 });

        const points: Point2D[] = [];
        for (let i = 0; i < 36; i++) {
          const angle = (i / 36) * Math.PI * 2;
          points.push({
            x: pCenter.x + Math.cos(angle) * newRadius,
            y: pCenter.y + Math.sin(angle) * newRadius
          });
        }
        return { ...p, center: pCenter, radius: newRadius, points };
      }
      return p;
    });
    
    onUpdateActiveSketch({ ...activeSketch, profiles: updatedProfiles });
  };

  const handleUpdateCircleCenter = (newX?: number, newY?: number) => {
    if (!activeSketch) return;
    const targetCircle = profiles.find((p: any) => p.type === "circle");
    if (!targetCircle) return;

    const currentCenter = targetCircle.center || (targetCircle.points?.length ? {
      x: targetCircle.points.reduce((acc: number, pt: Point2D) => acc + pt.x, 0) / targetCircle.points.length,
      y: targetCircle.points.reduce((acc: number, pt: Point2D) => acc + pt.y, 0) / targetCircle.points.length,
    } : { x: 0, y: 0 });

    const finalX = (newX !== undefined && !isNaN(newX)) ? newX : currentCenter.x;
    const finalY = (newY !== undefined && !isNaN(newY)) ? newY : currentCenter.y;
    const deltaX = finalX - currentCenter.x;
    const deltaY = finalY - currentCenter.y;

    if (Math.abs(deltaX) < 1e-6 && Math.abs(deltaY) < 1e-6) return;

    let updatedProfiles = activeSketch.profiles.map((p: any) => {
      const isSelected = selectedProfileIdsList.includes(p.id);
      const belongsToPatternGroup = applyToPattern && p.patternGroupId && profiles.some((sel: any) => sel.type === "circle" && sel.patternGroupId === p.patternGroupId);

      if ((isSelected || belongsToPatternGroup) && p.type === "circle") {
        const pCenter = p.center || (p.points?.length ? {
          x: p.points.reduce((acc: number, pt: Point2D) => acc + pt.x, 0) / p.points.length,
          y: p.points.reduce((acc: number, pt: Point2D) => acc + pt.y, 0) / p.points.length,
        } : { x: 0, y: 0 });

        const cX = p.id === targetCircle.id ? finalX : pCenter.x + deltaX;
        const cY = p.id === targetCircle.id ? finalY : pCenter.y + deltaY;
        const rad = p.radius || 10;

        const points: Point2D[] = [];
        for (let i = 0; i < 36; i++) {
          const angle = (i / 36) * Math.PI * 2;
          points.push({
            x: cX + Math.cos(angle) * rad,
            y: cY + Math.sin(angle) * rad
          });
        }

        return {
          ...p,
          center: { x: cX, y: cY },
          points
        };
      }
      return p;
    });

    onUpdateActiveSketch({ ...activeSketch, profiles: updatedProfiles });
  };

  const handleUpdateRectangleDims = (newW?: number, newH?: number) => {
    if (!profile || !profile.points || profile.points.length < 4) return;
    const xs = profile.points.map((p: Point2D) => p.x);
    const ys = profile.points.map((p: Point2D) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const currentW = Math.max(0.01, maxX - minX);
    const currentH = Math.max(0.01, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const targetW = (newW !== undefined && !isNaN(newW) && newW > 0) ? newW : currentW;
    const targetH = (newH !== undefined && !isNaN(newH) && newH > 0) ? newH : currentH;

    const halfW = targetW / 2;
    const halfH = targetH / 2;

    let updatedProfiles = activeSketch.profiles.map((p: any) => {
      const isSelected = selectedProfileIdsList.includes(p.id);
      const belongsToPatternGroup = applyToPattern && p.patternGroupId && profiles.some((sel: any) => sel.type === "rectangle" && sel.patternGroupId === p.patternGroupId);
      if ((isSelected || belongsToPatternGroup) && p.type === "rectangle" && p.points && p.points.length >= 4) {
        const pXs = p.points.map((pt: Point2D) => pt.x);
        const pYs = p.points.map((pt: Point2D) => pt.y);
        const pCenterX = (Math.min(...pXs) + Math.max(...pXs)) / 2;
        const pCenterY = (Math.min(...pYs) + Math.max(...pYs)) / 2;
        const pts: Point2D[] = [
          { x: parseFloat((pCenterX - halfW).toFixed(2)), y: parseFloat((pCenterY - halfH).toFixed(2)) },
          { x: parseFloat((pCenterX + halfW).toFixed(2)), y: parseFloat((pCenterY - halfH).toFixed(2)) },
          { x: parseFloat((pCenterX + halfW).toFixed(2)), y: parseFloat((pCenterY + halfH).toFixed(2)) },
          { x: parseFloat((pCenterX - halfW).toFixed(2)), y: parseFloat((pCenterY + halfH).toFixed(2)) },
        ];
        return { ...p, points: pts };
      }
      return p;
    });

    onUpdateActiveSketch({ ...activeSketch, profiles: updatedProfiles });
  };

  const handleUpdateTriangleDims = (newBase?: number, newHeight?: number) => {
    if (!profile || !profile.points || profile.points.length < 3) return;
    const xs = profile.points.map((p: Point2D) => p.x);
    const ys = profile.points.map((p: Point2D) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const currentW = Math.max(0.01, maxX - minX);
    const currentH = Math.max(0.01, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scaleX = (newBase !== undefined && !isNaN(newBase) && newBase > 0) ? (newBase / currentW) : 1;
    const scaleY = (newHeight !== undefined && !isNaN(newHeight) && newHeight > 0) ? (newHeight / currentH) : 1;

    const newPoints: Point2D[] = profile.points.map((pt: Point2D) => ({
      x: parseFloat((centerX + (pt.x - centerX) * scaleX).toFixed(2)),
      y: parseFloat((centerY + (pt.y - centerY) * scaleY).toFixed(2)),
    }));

    updateProfile({ ...profile, points: newPoints });
  };

  const handleUpdatePolygonRadius = (newRadius: number) => {
    if (!profile || isNaN(newRadius) || newRadius <= 0 || !profile.points) return;
    const xs = profile.points.map((p: Point2D) => p.x);
    const ys = profile.points.map((p: Point2D) => p.y);
    const centerX = profile.center?.x ?? ((Math.min(...xs) + Math.max(...xs)) / 2);
    const centerY = profile.center?.y ?? ((Math.min(...ys) + Math.max(...ys)) / 2);
    const currentRadius = profile.radius || Math.hypot(profile.points[0].x - centerX, profile.points[0].y - centerY) || 1;
    const scale = newRadius / currentRadius;

    const newPoints: Point2D[] = profile.points.map((pt: Point2D) => ({
      x: parseFloat((centerX + (pt.x - centerX) * scale).toFixed(2)),
      y: parseFloat((centerY + (pt.y - centerY) * scale).toFixed(2)),
    }));

    updateProfile({ ...profile, points: newPoints, radius: newRadius, center: { x: centerX, y: centerY } });
  };

  const handleUpdateLineDims = (newLen?: number, newAngleDeg?: number) => {
    if (!profile || !profile.points || profile.points.length < 2) return;
    const p0 = profile.points[0];
    const pEnd = profile.points[profile.points.length - 1];
    const dx = pEnd.x - p0.x;
    const dy = pEnd.y - p0.y;
    const currentLen = Math.max(0.01, Math.hypot(dx, dy));
    const currentAngle = Math.atan2(dy, dx);

    const targetLen = (newLen !== undefined && !isNaN(newLen) && newLen > 0) ? newLen : currentLen;
    const targetAngle = (newAngleDeg !== undefined && !isNaN(newAngleDeg)) ? (newAngleDeg * Math.PI / 180) : currentAngle;

    const newPEnd: Point2D = {
      x: parseFloat((p0.x + Math.cos(targetAngle) * targetLen).toFixed(2)),
      y: parseFloat((p0.y + Math.sin(targetAngle) * targetLen).toFixed(2)),
    };

    const newPoints = [...profile.points];
    newPoints[newPoints.length - 1] = newPEnd;
    updateProfile({ ...profile, points: newPoints });
  };

  const handleUpdateGeneralDims = (newW?: number, newH?: number) => {
    if (!profile || !profile.points || profile.points.length < 2) return;
    const xs = profile.points.map((p: Point2D) => p.x);
    const ys = profile.points.map((p: Point2D) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const currentW = Math.max(0.01, maxX - minX);
    const currentH = Math.max(0.01, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scaleX = (newW !== undefined && !isNaN(newW) && newW > 0) ? (newW / currentW) : 1;
    const scaleY = (newH !== undefined && !isNaN(newH) && newH > 0) ? (newH / currentH) : 1;

    const newPoints: Point2D[] = profile.points.map((pt: Point2D) => ({
      x: parseFloat((centerX + (pt.x - centerX) * scaleX).toFixed(2)),
      y: parseFloat((centerY + (pt.y - centerY) * scaleY).toFixed(2)),
    }));

    updateProfile({ ...profile, points: newPoints });
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
          <Settings2 size={15} className="text-blue-400" /> {profiles.length > 1 ? `Properties (${profiles.length})` : "Sketch Properties"}
        </span>
        <button 
          onClick={() => setCollapsed(value => !value)}
          className="text-text-muted hover:text-white p-1 hover:bg-white/10 rounded transition-colors cursor-pointer"
          title={collapsed ? "Expand properties" : "Minimize properties"}
          aria-label={collapsed ? "Expand properties" : "Minimize properties"}
          aria-expanded={!collapsed}
        >
          <span aria-hidden="true">{collapsed ? '＋' : '−'}</span>
        </button>
      </div>
      
      {!collapsed && <div className="p-3 flex flex-col gap-1">
        {showProfileList && <label className="flex flex-col gap-2 text-xs text-zinc-300 mb-2">
          Shape to edit
          <select aria-label="Shape to edit" value={profiles.length === 1 ? profile.id : ''}
            onChange={event => setSelectedProfileIds(event.target.value ? [event.target.value] : [])}
            className="w-full bg-zinc-900 border border-white/20 rounded p-2 text-white">
            <option value="">{profiles.length > 1 ? 'Multiple shapes selected' : 'Select a shape'}</option>
            {activeSketch.profiles.map((item: Profile, index: number) => <option key={item.id} value={item.id}>
              {index + 1}. {({ circle: 'Circle', rectangle: 'Rectangle', polygon: 'Polygon', hexagon: 'Hexagon', triangle: 'Triangle', slot: 'Slot', arc: 'Arc', line: 'Line' } as Record<string, string>)[item.type] || 'Shape'}
            </option>)}
          </select>
          {!profiles.length && <p className="text-zinc-400 leading-relaxed">{activeSketch.profiles.length ? 'Select a shape here or on the sketch to modify its dimensions and position.' : 'Draw a shape to edit its properties here.'}</p>}
        </label>}
        {profiles.length > 0 && <>
        {/* Directly Extrude */}
        {onExtrudeProfile && (
          <button
            type="button"
            onClick={() => onExtrudeProfile(profile.id)}
            className="w-full flex justify-center items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black shadow-[0_2px_10px_rgba(245,158,11,0.3)] hover:shadow-amber-500/30 transition-all active:scale-95 cursor-pointer mb-2 border border-amber-400/60"
            title="Directly extrude this selected shape to 3D solid"
          >
            <Sparkles size={14} className="text-black stroke-[2.5]" />
            <span>⚡ Extrude Shape to 3D</span>
          </button>
        )}

        {/* Delete */}
        <button onClick={deleteProfile} className="w-full flex justify-center items-center gap-2 p-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all cursor-pointer mb-2">
          <Trash2 size={14} /> Delete Shape
        </button>

        {/* Circle Dimensions and Center */}
        {profiles.some((p: any) => p.type === "circle") && (() => {
          const circleProf = profiles.find((p: any) => p.type === "circle");
          const rad = circleProf?.radius || 0;
          const centerX = circleProf?.center?.x ?? (circleProf?.points?.length ? (circleProf.points.reduce((acc: number, pt: Point2D) => acc + pt.x, 0) / circleProf.points.length) : 0);
          const centerY = circleProf?.center?.y ?? (circleProf?.points?.length ? (circleProf.points.reduce((acc: number, pt: Point2D) => acc + pt.y, 0) / circleProf.points.length) : 0);

          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title={profiles.filter((p:any) => p.type==="circle").length > 1 ? "Selected Circles" : "Circle Dimensions"} icon={Settings2} />
              <div className="flex flex-col gap-2 text-[11px]">
                {/* Center Position */}
                <div className="flex items-center justify-between border-b border-white/5 pb-1 text-zinc-300 font-medium">
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                    Center Position:
                  </span>
                  <span className="font-mono text-[10px] text-amber-400 font-bold">
                    ({formatMeasurement(centerX)}, {formatMeasurement(centerY)})
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Center X:</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Center X"
                      value={centerX}
                      onValueChange={(val: number) => handleUpdateCircleCenter(val, undefined)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Center Y:</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Center Y"
                      value={centerY}
                      onValueChange={(val: number) => handleUpdateCircleCenter(undefined, val)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>

                {/* Radius and Diameter */}
                <div className="border-t border-white/5 pt-1.5 flex items-center justify-between">
                  <span className="text-zinc-400">Radius (R):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Radius"
                      value={rad}
                      onValueChange={handleUpdateCircleRadii}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="0.5"
                      min="0.001"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono border-t border-white/5 pt-1">
                  <span>Diameter (Ø):</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatMeasurement(rad * 2)} mm</span>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none pt-0.5">
                  <input type="checkbox" checked={applyToPattern} onChange={(e) => setApplyToPattern(e.target.checked)} className="accent-blue-500 rounded" />
                  <span className="text-[10px]">Propagate to entire pattern</span>
                </label>
              </div>
            </div>
          );
        })()}

        {/* Rectangle Dimensions */}
        {profiles.some((p: any) => p.type === "rectangle") && (() => {
          const rectProf = profiles.find((p: any) => p.type === "rectangle");
          if (!rectProf || !rectProf.points || rectProf.points.length < 4) return null;
          const xs = rectProf.points.map((pt: Point2D) => pt.x);
          const ys = rectProf.points.map((pt: Point2D) => pt.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const w = Math.max(0.01, maxX - minX);
          const h = Math.max(0.01, maxY - minY);
          const area = w * h;
          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title={profiles.filter((p: any) => p.type === "rectangle").length > 1 ? "Dimensions (Rectangles)" : "Rectangle Dimensions"} icon={Square} />
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Width (W):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Rectangle Width"
                      value={w}
                      onValueChange={(val: number) => handleUpdateRectangleDims(val, undefined)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Height (H):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Rectangle Height"
                      value={h}
                      onValueChange={(val: number) => handleUpdateRectangleDims(undefined, val)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono border-t border-white/5 pt-1">
                  <span>Area:</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatMeasurement(area)} mm²</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none pt-0.5">
                  <input type="checkbox" checked={applyToPattern} onChange={(e) => setApplyToPattern(e.target.checked)} className="accent-blue-500 rounded" />
                  <span className="text-[10px]">Propagate to entire pattern</span>
                </label>
              </div>
            </div>
          );
        })()}

        {/* Triangle Dimensions */}
        {profiles.some((p: any) => p.type === "triangle") && (() => {
          const triProf = profiles.find((p: any) => p.type === "triangle");
          if (!triProf || !triProf.points || triProf.points.length < 3) return null;
          const xs = triProf.points.map((pt: Point2D) => pt.x);
          const ys = triProf.points.map((pt: Point2D) => pt.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const w = Math.max(0.01, maxX - minX);
          const h = Math.max(0.01, maxY - minY);
          const area = 0.5 * w * h;
          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title="Triangle Dimensions" icon={Triangle} />
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Base / Width:</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Triangle Base"
                      value={w}
                      onValueChange={(val: number) => handleUpdateTriangleDims(val, undefined)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Height:</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Triangle Height"
                      value={h}
                      onValueChange={(val: number) => handleUpdateTriangleDims(undefined, val)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono border-t border-white/5 pt-1">
                  <span>Approx Area:</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatMeasurement(area)} mm²</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Polygon / Hexagon Dimensions */}
        {profiles.some((p: any) => p.type === "hexagon" || (p.type === "polygon" && p.isClosed && p.points?.length >= 5)) && (() => {
          const polyProf = profiles.find((p: any) => p.type === "hexagon" || (p.type === "polygon" && p.isClosed && p.points?.length >= 5));
          if (!polyProf || !polyProf.points || polyProf.points.length < 3) return null;
          const xs = polyProf.points.map((pt: Point2D) => pt.x);
          const ys = polyProf.points.map((pt: Point2D) => pt.y);
          const cX = polyProf.center?.x ?? ((Math.min(...xs) + Math.max(...xs)) / 2);
          const cY = polyProf.center?.y ?? ((Math.min(...ys) + Math.max(...ys)) / 2);
          const rad = polyProf.radius ?? Math.hypot(polyProf.points[0].x - cX, polyProf.points[0].y - cY);
          const side = polyProf.points.length >= 2 ? Math.hypot(polyProf.points[1].x - polyProf.points[0].x, polyProf.points[1].y - polyProf.points[0].y) : 0;
          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title={polyProf.type === "hexagon" ? "Hexagon Dimensions" : `Regular Polygon (${polyProf.points.length} Sides)`} icon={Hexagon} />
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Outer Radius (R):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Polygon Radius"
                      value={rad}
                      onValueChange={handleUpdatePolygonRadius}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono border-t border-white/5 pt-1">
                  <span>Diameter (Ø):</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatMeasurement(rad * 2)} mm</span>
                </div>
                <div className="flex items-center justify-between text-text-muted text-[10px] font-mono">
                  <span>Side Length:</span>
                  <span className="text-zinc-300 font-mono">{formatMeasurement(side)} mm</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Line / Segment Dimensions */}
        {profiles.some((p: any) => !p.isClosed || (p.points && p.points.length === 2)) && (() => {
          const lineProf = profiles.find((p: any) => !p.isClosed || (p.points && p.points.length === 2));
          if (!lineProf || !lineProf.points || lineProf.points.length < 2) return null;
          const p0 = lineProf.points[0];
          const pEnd = lineProf.points[lineProf.points.length - 1];
          const dx = pEnd.x - p0.x;
          const dy = pEnd.y - p0.y;
          const len = Math.hypot(dx, dy);
          const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title="Line / Segment Dimensions" icon={PenTool} />
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Length (L):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Line Length"
                      value={len}
                      onValueChange={(val: number) => handleUpdateLineDims(val, undefined)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Angle (∠):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Line Angle"
                      value={angle}
                      onValueChange={(val: number) => handleUpdateLineDims(undefined, val)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">°</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* General Dimensions for other shapes */}
        {profiles.some((p: any) => p.isClosed && p.type !== "circle" && p.type !== "rectangle" && p.type !== "triangle" && p.type !== "hexagon" && p.points && p.points.length >= 3) && (() => {
          const genProf = profiles.find((p: any) => p.isClosed && p.type !== "circle" && p.type !== "rectangle" && p.type !== "triangle" && p.type !== "hexagon" && p.points && p.points.length >= 3);
          if (!genProf || !genProf.points) return null;
          const xs = genProf.points.map((pt: Point2D) => pt.x);
          const ys = genProf.points.map((pt: Point2D) => pt.y);
          const w = Math.max(0.01, Math.max(...xs) - Math.min(...xs));
          const h = Math.max(0.01, Math.max(...ys) - Math.min(...ys));
          return (
            <div className="mb-2 bg-black/30 p-2.5 rounded-lg border border-blue-500/20">
              <SectionHeader title="Shape Dimensions" icon={Ruler} />
              <div className="flex flex-col gap-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total Width (W):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Shape Width"
                      value={w}
                      onValueChange={(val: number) => handleUpdateGeneralDims(val, undefined)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total Height (H):</span>
                  <div className="flex items-center gap-1">
                    <MeasurementInput
                      aria-label="Shape Height"
                      value={h}
                      onValueChange={(val: number) => handleUpdateGeneralDims(undefined, val)}
                      className="w-20 bg-black/50 border border-white/15 p-1 rounded text-white outline-none text-center font-mono font-bold hover:border-amber-400 focus:border-amber-400"
                      step="1"
                      min="0.1"
                    />
                    <span className="text-text-muted font-mono text-[10px]">mm</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Coordinates */}
        {profiles.length === 1 && <SectionHeader title="Coordinates (Vertices)" icon={Move} />}
        {profiles.length === 1 && <div className="flex flex-col gap-1 max-h-32 overflow-y-auto custom-scrollbar pr-1 mb-2">
          {profile.points?.map((pt: Point2D, i: number) => (
            <div key={i} className="flex items-center justify-between text-[10px] bg-black/20 p-1 rounded">
              <span className="text-zinc-500 w-4">V{i}</span>
              <div className="flex gap-1">
                <div className="flex items-center bg-black/40 rounded px-1 border border-white/10">
                  <span className="text-red-400 mr-1">X</span>
                  <MeasurementInput key={`${profile.id}-x-${i}`} aria-label={`Vertex ${i} X`} value={pt.x} onValueChange={value => handleVertexChange(i, 'x', value)} className="w-20 bg-transparent text-white outline-none text-right" />
                </div>
                <div className="flex items-center bg-black/40 rounded px-1 border border-white/10">
                  <span className="text-green-400 mr-1">Y</span>
                  <MeasurementInput key={`${profile.id}-y-${i}`} aria-label={`Vertex ${i} Y`} value={pt.y} onValueChange={value => handleVertexChange(i, 'y', value)} className="w-20 bg-transparent text-white outline-none text-right" />
                </div>
              </div>
            </div>
          ))}
        </div>}

        {/* Move / Copy */}
        <SectionHeader title="Move / Copy" icon={Copy} />
        <div className="flex flex-col gap-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none">
            <input type="checkbox" checked={moveCopy} onChange={(e) => setMoveCopy(e.target.checked)} className="accent-blue-500" />
            <span>Keep original (Copy)</span>
          </label>
          <div className="flex gap-2">
            <MeasurementInput aria-label="Offset X" placeholder="dX" value={dx} onValueChange={setDx} className="w-full min-w-0 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
            <MeasurementInput aria-label="Offset Y" placeholder="dY" value={dy} onValueChange={setDy} className="w-full min-w-0 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
            <button onClick={handleMove} className="bg-blue-600 hover:bg-blue-500 text-white rounded px-2 cursor-pointer font-bold">Apply</button>
          </div>
        </div>

        {/* Mirror */}
        <SectionHeader title="Mirror" icon={FlipHorizontal} />
        <div className="flex flex-col gap-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white select-none">
            <input type="checkbox" checked={mirrorCopy} onChange={(e) => setMirrorCopy(e.target.checked)} className="accent-blue-500" />
            <span>Keep original</span>
          </label>
          <div className="flex gap-2">
            <button onClick={() => handleMirror('y')} className="flex-1 p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-zinc-300 hover:text-white">Mirror X Axis</button>
            <button onClick={() => handleMirror('x')} className="flex-1 p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-zinc-300 hover:text-white">Mirror Y Axis</button>
          </div>
          <button onClick={() => onStartCustomMirror?.(mirrorCopy)} className="w-full p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded font-bold text-center cursor-pointer border border-blue-500/20 transition-all mt-1 flex items-center justify-center gap-1.5">
            <Slash size={12} className="rotate-90" /> Define Axis on Screen
          </button>
        </div>

        {/* Linear Pattern */}
        <SectionHeader title="Linear Pattern" icon={Maximize2} />
        <div className="flex flex-col gap-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400 w-8">X Axis:</span>
            <div className="flex gap-1 items-center flex-1">
              <input type="number" value={linearCountX} onChange={(e) => setLinearCountX(parseInt(e.target.value))} min="1" className="w-10 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Copies in X" />
              <span className="text-zinc-500">x</span>
              <MeasurementInput value={linearDx} onValueChange={setLinearDx} className="w-full min-w-0 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Distance X" />
              <span className="text-zinc-500">mm</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400 w-8">Y Axis:</span>
            <div className="flex gap-1 items-center flex-1">
              <input type="number" value={linearCountY} onChange={(e) => setLinearCountY(parseInt(e.target.value))} min="1" className="w-10 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Copies in Y" />
              <span className="text-zinc-500">x</span>
              <MeasurementInput value={linearDy} onValueChange={setLinearDy} className="w-full min-w-0 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" title="Distance Y" />
              <span className="text-zinc-500">mm</span>
            </div>
          </div>
          <button onClick={handleLinearPattern} className="w-full p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-blue-400 hover:text-blue-300 mt-1">Generate 2D Pattern</button>
        </div>

        {/* Circular Pattern */}
        <SectionHeader title="Circular Pattern" icon={CircleDashed} />
        <div className="flex flex-col gap-2 text-[11px] mb-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Total copies:</span>
            <input type="number" value={circularCount} onChange={(e) => setCircularCount(parseInt(e.target.value))} min="2" className="w-12 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-zinc-400 flex-1">Total angle (°):</span>
            <MeasurementInput aria-label="Total angle" value={circularAngle} onValueChange={setCircularAngle} className="w-20 bg-black/40 border border-white/10 p-1 rounded text-white outline-none text-center" />
          </div>
          <button onClick={handleCircularPattern} className="w-full p-1.5 bg-white/5 hover:bg-white/10 rounded font-bold text-center cursor-pointer border border-white/5 transition-all text-blue-400 hover:text-blue-300 mt-1">Generate Pattern (Origin)</button>
        </div>
        </>}
      </div>}
    </div>
  );
}

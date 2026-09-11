import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Magnet, ChevronDown, X } from 'lucide-react';
import { DEFAULT_OSNAP, OSNAPSettings } from '../utils/snappingUtils';

export function readSnapPreferences() {
  const defaults = { settings: { ...DEFAULT_OSNAP }, enabled: true, pixels: 12, grid: 5 };
  try {
    const saved = JSON.parse(localStorage.getItem('voxel3d.osnap.v1') || 'null');
    if (!saved) return defaults;
    for (const key of Object.keys(defaults.settings) as (keyof OSNAPSettings)[]) {
      if (typeof saved.settings?.[key] === 'boolean') defaults.settings[key] = saved.settings[key];
    }
    defaults.enabled = saved.enabled !== false;
    if (Number.isFinite(saved.pixels)) defaults.pixels = Math.max(4, Math.min(24, saved.pixels));
    if (Number.isFinite(saved.grid) && saved.grid > 0) defaults.grid = saved.grid;
  } catch { /* Storage can be unavailable in private sessions. */ }
  return defaults;
}

const options: [keyof OSNAPSettings, string][] = [
  ['vertex', 'Extremos / vértices'], ['midpoint', 'Puntos medios'],
  ['center', 'Centros'], ['quadrant', 'Cuadrantes de círculos'],
  ['intersection', 'Intersecciones de aristas'], ['nearest', 'Punto más cercano'],
  ['perpendicular', 'Perpendicular desde el último punto'], ['parallel', 'Paralela desde el último punto'],
  ['tangent', 'Tangente a círculos del boceto'], ['guides', 'Alineación horizontal / vertical'],
  ['symmetry', 'Simetría respecto a los ejes'], ['grid', 'Cuadrícula'],
];

type Props = {
  settings: OSNAPSettings; onSettings: (value: OSNAPSettings) => void;
  enabled: boolean; onEnabled: (value: boolean) => void;
  pixels: number; onPixels: (value: number) => void;
  grid: number; onGrid: (value: number) => void; referenceCount: number;
};

export default function SnapControls(p: Props) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setPosition(null); trigger.current?.focus(); } };
    const resize = () => setPosition(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); };
  }, [position]);
  return <div className="flex shrink-0 items-center">
    <button className="editor-button" aria-pressed={p.enabled} title="Activar o pausar las ayudas (F3). Conserva tu selección." onClick={() => p.onEnabled(!p.enabled)}><Magnet size={15} />Snap {p.enabled ? 'ON' : 'OFF'}</button>
    <button ref={trigger} className="editor-button" aria-label="Configurar ayudas de captura" aria-expanded={!!position} aria-controls="snap-options" onClick={() => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition(position ? null : { left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 420)) });
    }}><ChevronDown size={15} /></button>
    {position && createPortal(<div ref={menu} id="snap-options" role="region" aria-label="Ayudas de captura CAD" className="fixed z-[100] rounded-xl border border-border-main bg-panel text-text-main shadow-2xl p-4 overflow-y-auto" style={{ ...position, width: 'min(320px, calc(100vw - 16px))', maxHeight: 'min(540px, calc(100vh - 16px))' }}>
      <div className="flex justify-between items-center mb-3"><strong>Ayudas de captura CAD</strong><button className="editor-button" aria-label="Cerrar ayudas de captura" onClick={() => { setPosition(null); trigger.current?.focus(); }}><X size={15} /></button></div>
      <label className="flex gap-2 items-start text-sm mb-2"><input type="checkbox" checked={p.settings.background} onChange={e => p.onSettings({ ...p.settings, background: e.target.checked })} />Usar piezas anteriores proyectadas en este plano</label>
      <p className="text-xs text-text-muted mb-3">{p.referenceCount} aristas de referencia. Se incluyen proyecciones y cortes del plano. Las capturas son referencias de dibujo, no restricciones permanentes.</p>
      <fieldset className="grid gap-2 border-t border-border-main pt-3"><legend className="text-sm px-1">Capturas disponibles</legend>{options.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm py-1"><input type="checkbox" checked={!!p.settings[key]} onChange={e => p.onSettings({ ...p.settings, [key]: e.target.checked })} />{label}</label>)}</fieldset>
      <label className="block text-sm mt-3">Radio de captura: {p.pixels} px<input className="block w-full mt-1" type="range" min="4" max="24" step="1" value={p.pixels} onChange={e => p.onPixels(Number(e.target.value))} /></label>
      <label className="flex items-center gap-2 text-sm mt-3">Paso de cuadrícula (mm)<input className="w-20 rounded bg-surface border border-border-main p-1" type="number" min="0.01" step="0.5" value={p.grid} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value > 0) p.onGrid(value); }} /></label>
      <button className="editor-button mt-3" onClick={() => { p.onSettings({ ...DEFAULT_OSNAP }); p.onPixels(12); p.onGrid(5); }}>Restaurar ayudas recomendadas</button>
      {!p.enabled && <p className="text-sm text-text-muted mt-2" role="status">Captura en pausa. Pulsa F3 o Snap OFF para activarla.</p>}
    </div>, document.body)}
  </div>;
}

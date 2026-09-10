/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { 
  Play, 
  Trash2, 
  PenTool, 
  Settings2, 
  Compass, 
  Workflow, 
  Triangle,
  History,
  Edit3
} from "lucide-react";
import { HistoryItem } from "../types";

interface TimelineProps {
  history: HistoryItem[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onDeleteHistoryItem: (id: string) => void;
  isSketchMode?: boolean;
  onEditSketch?: (id: string) => void;
}

export default function Timeline({
  history,
  activeIndex,
  setActiveIndex,
  onDeleteHistoryItem,
  isSketchMode,
  onEditSketch
}: TimelineProps) {
  return (
    <div className="bg-panel border border-border-main rounded p-3 shadow-lg flex flex-col gap-2 font-sans">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
          <History size={14} className="text-blue-400" />
          <span>Cronología de Operaciones (CAD Timeline Stack)</span>
        </div>
        <span className="text-[9px] font-bold text-text-main/40 uppercase tracking-[1.5px] bg-highlight-subtle px-2 py-0.5 rounded border border-border-subtle">
          Step-History
        </span>
      </div>

      {/* Steps Flow list */}
      <div className="flex items-center gap-2 overflow-x-auto py-2 px-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent font-sans">
        {/* Play Icon Indicator at starting block */}
        <div className="flex items-center justify-center w-8 h-8 rounded bg-highlight-subtle border border-border-main text-text-muted shrink-0">
          <Play size={11} fill="currentColor" />
        </div>

        {history.map((item, index) => {
          const isSelected = index === activeIndex;
          const isSketch = item.type === "sketch";

          return (
            <React.Fragment key={item.id}>
              {/* Arrow Connector */}
              <div className="text-text-muted shrink-0 select-none text-xs">→</div>

              {/* History Block Card */}
              <div
                onClick={() => setActiveIndex(index)}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded border cursor-pointer hover:border-white/20 transition-all select-none shrink-0 ${
                  isSelected 
                    ? "bg-blue-600/15 border-blue-500/50 text-blue-400" 
                    : "bg-surface-hover border-border-subtle text-text-main"
                }`}
              >
                {/* Dynamic Icon */}
                <div className={`p-1 rounded ${
                  isSketch 
                    ? "bg-emerald-500/10 text-emerald-400" 
                    : "bg-blue-500/10 text-blue-400"
                }`}>
                  {isSketch ? <PenTool size={12} /> : <Settings2 size={12} />}
                </div>

                {/* Info Text */}
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold leading-tight uppercase tracking-wider opacity-60">
                    {isSketch ? "Boceto" : "Operación"}
                  </span>
                  <span className="text-xs font-semibold leading-none text-text-main font-sans">
                    {item.name}
                  </span>
                </div>

                {/* Edit sketch button */}
                {isSketch && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onEditSketch) onEditSketch(item.refId);
                    }}
                    className={`p-1 rounded shrink-0 flex items-center gap-1 transition-colors cursor-pointer ${
                      isSelected && isSketchMode
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "text-text-muted hover:text-emerald-400 hover:bg-highlight-subtle"
                    }`}
                    title="Editar este boceto en Modo Boceto"
                  >
                    <Edit3 size={11} />
                    <span className="text-[10px]">Editar boceto</span>
                  </button>
                )}

                {/* Delete button (only if not base sketch or can be removed) */}
                {history.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteHistoryItem(item.id);
                    }}
                    className="p-1 text-text-muted hover:text-red-400 rounded hover:bg-highlight-subtle shrink-0 transition-colors cursor-pointer"
                    title="Borrar operación"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </React.Fragment>
          );
        })}

        {history.length === 0 && (
          <div className="flex-1 text-center py-2 text-xs text-text-muted italic">No hay operaciones. Dibuja un perfil para comenzar.</div>
        )}
      </div>
    </div>
  );
}

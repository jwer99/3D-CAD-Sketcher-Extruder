import React from 'react';
import { X, Check } from 'lucide-react';

type Props = {
  hasSketch: boolean;
  hasSolid: boolean;
  onCreateSketch: () => void;
  onExtrude: () => void;
  onSave: () => void;
  onClose: () => void;
};

export default function FirstPieceGuide({ hasSketch, hasSolid, onCreateSketch, onExtrude, onSave, onClose }: Props) {
  return <section id="first-piece-guide" className="first-piece-guide" aria-labelledby="guide-title">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="guide-title" className="font-semibold">Tu primera pieza, en tres pasos</h2>
        <p className="text-sm text-text-muted mt-1">Añade un rectángulo editable de 40 × 30 mm a este proyecto y dale volumen. Si ya hay piezas, el ejemplo puede superponerse a ellas. Puedes deshacer con Ctrl+Z.</p></div>
      <button className="editor-button" onClick={onClose} aria-label="Cerrar guía"><X size={18} /></button>
    </div>
    <ol className="guide-steps">
      <li><strong>1. Prepara el boceto</strong><p>Un perfil cerrado define la base de la pieza.</p><button className="editor-button" disabled={hasSketch} onClick={onCreateSketch}>{hasSketch && <Check size={16} />}{hasSketch ? 'Boceto añadido' : 'Añadir rectángulo'}</button></li>
      <li><strong>2. Dale volumen</strong><p>Extruir convierte el perfil en un sólido de 10 mm de altura.</p><button className="editor-button" disabled={!hasSketch || hasSolid} onClick={onExtrude}>{hasSolid && <Check size={16} />}{hasSolid ? 'Sólido creado' : 'Extruir 10 mm'}</button></li>
      <li><strong>3. Guarda tu proyecto</strong><p>Descarga un archivo editable. Para STEP o STL, usa la exportación del panel lateral.</p><button className="editor-button" disabled={!hasSolid} onClick={onSave}>Descargar proyecto</button></li>
    </ol>
    <p className="text-sm text-text-muted" role="status">{hasSolid ? 'Pieza creada. Puedes modificarla desde el panel de herramientas o seguir diseñando.' : hasSketch ? 'Boceto listo. Continúa con la extrusión.' : 'Empieza añadiendo el rectángulo al proyecto actual.'}</p>
  </section>;
}

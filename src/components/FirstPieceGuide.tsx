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
      <div><h2 id="guide-title" className="font-semibold">Your first part, in three steps</h2>
        <p className="text-sm text-text-muted mt-1">Add an editable 40 × 30 mm rectangle to this project and give it volume. If parts already exist, the example may overlap with them. You can undo with Ctrl+Z.</p></div>
      <button className="editor-button" onClick={onClose} aria-label="Close guide"><X size={18} /></button>
    </div>
    <ol className="guide-steps">
      <li><strong>1. Prepare the sketch</strong><p>A closed profile defines the base of the part.</p><button className="editor-button" disabled={hasSketch} onClick={onCreateSketch}>{hasSketch && <Check size={16} />}{hasSketch ? 'Sketch added' : 'Add rectangle'}</button></li>
      <li><strong>2. Give it volume</strong><p>Extruding converts the profile into a solid 10 mm tall.</p><button className="editor-button" disabled={!hasSketch || hasSolid} onClick={onExtrude}>{hasSolid && <Check size={16} />}{hasSolid ? 'Solid created' : 'Extrude 10 mm'}</button></li>
      <li><strong>3. Save your project</strong><p>Download an editable file. For STEP or STL, use the export section in the side panel.</p><button className="editor-button" disabled={!hasSolid} onClick={onSave}>Download project</button></li>
    </ol>
    <p className="text-sm text-text-muted" role="status">{hasSolid ? 'Part created. You can modify it from the tools panel or continue designing.' : hasSketch ? 'Sketch ready. Proceed with extrusion.' : 'Start by adding the rectangle to the current project.'}</p>
  </section>;
}

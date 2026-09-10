import React, { useEffect, useState } from 'react';

export const formatMeasurement = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(3))) : '';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onValueChange: (value: number) => void;
};

// Keep a draft so deleting, typing a minus sign or a decimal does not alter geometry.
export default function MeasurementInput({ value, onValueChange, ...props }: Props) {
  const [draft, setDraft] = useState(() => formatMeasurement(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(formatMeasurement(value)); }, [value, editing]);
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    const valid = draft.trim() !== '' && Number.isFinite(parsed)
      && (props.min === undefined || parsed >= Number(props.min))
      && (props.max === undefined || parsed <= Number(props.max));
    if (valid && draft !== formatMeasurement(value)) onValueChange(parsed);
    setDraft(formatMeasurement(valid ? parsed : value));
    setEditing(false);
  };
  return <input {...props} type="text" inputMode="decimal" value={draft}
    onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.stopPropagation(); setDraft(formatMeasurement(value)); setEditing(false); }
    }} />;
}

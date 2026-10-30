import { useLayoutEffect, useRef, useState } from 'react';

/** Card title: one line at rest, grows to show the whole text while being edited. */
export default function TitleField({ value, onChange, autoFocus }) {
  const input = useRef(null);
  const [editing, setEditing] = useState(Boolean(autoFocus));

  useLayoutEffect(() => {
    const el = input.current;
    el.style.height = '';
    if (!editing) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value, editing]);

  return (
    <label className="field">
      <span className="field-label">Название</span>
      <textarea ref={input} className={`title-input ${editing ? 'title-input-editing' : ''}`} rows={1}
        value={value} maxLength={500} autoFocus={autoFocus}
        onFocus={() => setEditing(true)} onClick={() => setEditing(true)} onBlur={() => setEditing(false)}
        onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }} />
    </label>
  );
}

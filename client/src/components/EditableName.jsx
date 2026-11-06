import { useEffect, useRef, useState } from 'react';
import { useOutsidePress } from './ManageFields.jsx';

/** The field the name turns into: Enter, leaving it or a press outside saves, Escape cancels. */
function NameField({ value, label, maxLength, className, onSave, onDone }) {
  const [draft, setDraft] = useState(value);
  const input = useRef(null);
  const done = useRef(false);
  const finish = (save) => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim().slice(0, maxLength);
    if (save && name && name !== value) onSave(name);
    onDone();
  };
  useOutsidePress(input, () => finish(true));
  // Opened by a click on the name, so the field takes the focus right away.
  useEffect(() => {
    input.current.focus();
    input.current.select();
  }, []);
  // The field lies over an invisible copy of the text, so it takes the size the name had and nothing around moves.
  return (
    <span className={`editable-name-edit ${className}`}>
      <span className="editable-name-sizer" aria-hidden="true">{draft || ' '}</span>
      <input ref={input} className="editable-name-input" value={draft} maxLength={maxLength} aria-label={label}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }} />
    </span>
  );
}

/** A name renamed in place: a click (or Enter / F2 on it) turns it into a field. */
export default function EditableName({ value, label, maxLength = 200, className = '', onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <NameField value={value} label={label} maxLength={maxLength} className={className} onSave={onSave}
        onDone={() => setEditing(false)} />
    );
  }
  return (
    <span role="button" tabIndex={0} className={`editable-name ${className}`} title="Нажмите, чтобы переименовать"
      aria-label={`${value} — переименовать`}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'F2') return;
        e.preventDefault();
        setEditing(true);
      }}>
      {value}
    </span>
  );
}

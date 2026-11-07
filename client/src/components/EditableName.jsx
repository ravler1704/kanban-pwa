import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePress } from './ManageFields.jsx';

/** A note under `anchor` over the page (scrolling containers would cut it off), not moving anything. */
function Note({ anchor, id, children }) {
  const [pos, setPos] = useState(null);
  // After the commit, when the field is in place.
  useEffect(() => {
    const place = () => {
      if (!anchor.current) return;
      const r = anchor.current.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);
  if (!pos) return null;
  return createPortal(<div id={id} role="note" className="editable-name-note" style={pos}>{children}</div>, document.body);
}

/** The field the name turns into: Enter, leaving it or a press outside saves, Escape cancels. */
export function NameField({ value, label, maxLength, className, note, onSave, onDone }) {
  const [draft, setDraft] = useState(value);
  const input = useRef(null);
  const box = useRef(null);
  const noteId = useId();
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
    <span ref={box} className={`editable-name-edit ${className}`}>
      <span className="editable-name-sizer" aria-hidden="true">{draft || ' '}</span>
      <input ref={input} className="editable-name-input" value={draft} maxLength={maxLength} aria-label={label}
        aria-describedby={note ? noteId : undefined}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }} />
      {note && <Note anchor={box} id={noteId}>{note}</Note>}
    </span>
  );
}

/** A name renamed in place: a click (or Enter / F2 on it) turns it into a field; `note` is shown under it meanwhile. */
export default function EditableName({ value, label, maxLength = 200, className = '', note, onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <NameField value={value} label={label} maxLength={maxLength} className={className} note={note} onSave={onSave}
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

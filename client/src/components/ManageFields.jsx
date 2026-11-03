import { useEffect, useRef, useState } from 'react';

/** Text input that saves on Enter / blur and reverts on Escape. */
export function NameInput({ value, onSave, className = '', label, maxLength = 200 }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // Renamed elsewhere (e.g. synced from another device).
    setPrev(value);
    setDraft(value);
  }

  function commit() {
    const name = draft.trim();
    if (name && name !== value) onSave(name);
    else setDraft(value);
  }

  return (
    <label className="field manage-field">
      <span className="field-label">{label}</span>
      <input
        className={`manage-input ${className}`}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
          }
        }}
      />
    </label>
  );
}

/** Calls `handler` on a press outside `ref` (fields that open without focus close this way). */
export function useOutsidePress(ref, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) latest.current?.();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [ref]);
}

/** `onCancel`: the form closes on Escape, or when it is left or pressed outside while empty. */
export function AddForm({ label, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const form = useRef(null);
  useOutsidePress(form, () => onCancel && !name.trim() && onCancel());
  return (
    <form
      ref={form}
      className="manage-add"
      onSubmit={(e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        onAdd(value);
        setName('');
      }}
    >
      <label className="field manage-field">
        <span className="field-label">{label}</span>
        <input
          className="manage-input"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => onCancel && !name.trim() && !e.currentTarget.form.contains(e.relatedTarget) && onCancel()}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !onCancel) return;
            e.stopPropagation();
            onCancel();
          }}
        />
      </label>
      <button type="submit" className="btn btn-small" disabled={!name.trim()}>Добавить</button>
    </form>
  );
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** A «+ label» button that turns into an `AddForm` and back; `open` / `onOpenChange` control it from outside. */
export function AddButton({ label, onAdd, open: openProp, onOpenChange }) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  if (!open) {
    return <button type="button" className="btn field-add tree-add" onClick={() => setOpen(true)}>+ {label}</button>;
  }
  return <AddForm label={label} onAdd={onAdd} onCancel={() => setOpen(false)} />;
}

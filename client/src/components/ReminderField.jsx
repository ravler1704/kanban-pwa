import { useEffect, useRef } from 'react';

// <input type="datetime-local"> works with local time as "YYYY-MM-DDTHH:mm".
export function toInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromInputValue = (value) => (value ? new Date(value).getTime() : null);

/**
 * Expanded reminder; `value` is in the datetime-local format (see toInputValue), '' for none.
 * «Убрать» clears it and calls `onCollapse`.
 */
export default function ReminderField({ value, onChange, onCollapse }) {
  const input = useRef(null);

  useEffect(() => {
    if (input.current?.value) return;
    input.current?.focus();
    try {
      input.current?.showPicker?.();
    } catch {
      // Not allowed without a user gesture in some browsers; the focused field is enough.
    }
  }, []);

  return (
    <label className="field">
      <span className="field-label">Напоминание</span>
      <span className="reminder-input">
        <input ref={input} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn btn-small" onClick={() => {
          onChange('');
          onCollapse();
        }}>
          Убрать
        </button>
      </span>
    </label>
  );
}

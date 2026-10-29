import { useEffect, useRef, useState } from 'react';
import { enablePush, PUSH_HINTS, pushState } from '../push.js';

// <input type="datetime-local"> works with local time as "YYYY-MM-DDTHH:mm".
export function toInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromInputValue = (value) => (value ? new Date(value).getTime() : null);

/** Where the reminder will arrive; offers to enable notifications on this device. */
function ReminderPushStatus() {
  const [state, setState] = useState(pushState);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (state === 'enabled') return null;
  if (state !== 'available') return <p className="muted reminder-hint">{PUSH_HINTS[state]}</p>;
  return (
    <div className="reminder-hint">
      <button type="button" className="btn btn-small" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await enablePush();
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
          setState(pushState());
        }
      }}>
        Включить уведомления на этом устройстве
      </button>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

/**
 * `value` is in the datetime-local format (see toInputValue), '' for no reminder.
 * Without a reminder only an "add" button is shown.
 */
export default function ReminderField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    if (!open || value) return;
    input.current?.focus();
    try {
      input.current?.showPicker?.();
    } catch {
      // Not allowed without a user gesture in some browsers; the focused field is enough.
    }
  }, [open, value]);

  if (!open && !value) {
    return (
      <button type="button" className="btn reminder-add" onClick={() => setOpen(true)}>
        + Добавить напоминание
      </button>
    );
  }
  return (
    <>
      <label>
        Напоминание
        <span className="reminder-input">
          <input ref={input} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="btn btn-small" onClick={() => {
            onChange('');
            setOpen(false);
          }}>
            Убрать
          </button>
        </span>
      </label>
      {value && <ReminderPushStatus />}
    </>
  );
}

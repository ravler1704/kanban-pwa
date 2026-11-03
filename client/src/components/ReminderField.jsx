import { useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal.jsx';

// The value is local time as "YYYY-MM-DDTHH:mm" (the datetime-local format), '' for none.
const pad = (n) => String(n).padStart(2, '0');
const format = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function toInputValue(ts) {
  return ts ? format(new Date(ts)) : '';
}

export const fromInputValue = (value) => (value ? new Date(value).getTime() : null);

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const at = (day, h, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** «Сегодня, 18:00», «Завтра, 9:00», «пт, 7 нояб., 9:00» */
export function describeReminder(date, now = new Date()) {
  const time = date.toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `Сегодня, ${time}`;
  if (days === 1) return `Завтра, ${time}`;
  if (days === -1) return `Вчера, ${time}`;
  const options = { weekday: 'short', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return `${date.toLocaleDateString('ru-RU', options)}, ${time}`;
}

function presets(now) {
  const today = startOfDay(now);
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 5) * 5, 0, 0);
  const monday = addDays(today, ((8 - today.getDay()) % 7) || 7);
  return [
    { label: 'Через час', date: inHour },
    now.getHours() < 18 && { label: 'Сегодня вечером', date: at(today, 18) },
    { label: 'Завтра утром', date: at(addDays(today, 1), 9) },
    { label: 'В понедельник', date: at(monday, 9) },
    { label: 'Через неделю', date: at(addDays(today, 7), 9) },
  ].filter(Boolean);
}

/** Days of the month's grid, weeks from Monday; null pads the first week. */
function monthDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const pads = (first.getDay() + 6) % 7;
  return [
    ...Array(pads).fill(null),
    ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
}

function ReminderDialog({ value, onSave, onRemove, onClose }) {
  const now = new Date();
  const [draft, setDraft] = useState(() => (value ? new Date(value) : at(addDays(startOfDay(now), 1), 9)));
  const [month, setMonth] = useState(() => new Date(draft.getFullYear(), draft.getMonth(), 1));
  const today = startOfDay(now);
  const set = (next) => {
    setDraft(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };
  const shiftMonth = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const save = (date) => {
    onSave(format(date));
    onClose();
  };
  const minute = draft.getMinutes() - (draft.getMinutes() % 5);

  return (
    <Modal title="Напоминание" onClose={onClose} className="reminder-dialog" closeButton>
      <div className="rem-presets">
        {presets(now).map((p) => (
          <button key={p.label} type="button" className="btn btn-small rem-preset" onClick={() => save(p.date)}>
            {p.label}
            <span className="rem-preset-when">{describeReminder(p.date, now)}</span>
          </button>
        ))}
      </div>

      <div className="rem-calendar">
        <div className="rem-month">
          <button type="button" className="btn btn-small btn-icon-only" aria-label="Предыдущий месяц"
            disabled={month <= new Date(today.getFullYear(), today.getMonth(), 1)} onClick={() => shiftMonth(-1)}>‹</button>
          <span className="rem-month-name">
            {month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())}
          </span>
          <button type="button" className="btn btn-small btn-icon-only" aria-label="Следующий месяц"
            onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div className="rem-grid">
          {WEEKDAYS.map((d) => <span key={d} className="rem-weekday">{d}</span>)}
          {monthDays(month).map((day, i) => (day ? (
            <button key={i} type="button" disabled={day < today}
              className={`rem-day${sameDay(day, draft) ? ' rem-on' : ''}${sameDay(day, now) ? ' rem-today' : ''}`}
              onClick={() => set(at(day, draft.getHours(), draft.getMinutes()))}>
              {day.getDate()}
            </button>
          ) : <span key={i} />))}
        </div>
      </div>

      <div className="rem-time">
        <span className="rem-time-label">Час</span>
        <div className="rem-hours">
          {HOURS.map((h) => (
            <button key={h} type="button" className={`rem-cell${draft.getHours() === h ? ' rem-on' : ''}`}
              onClick={() => setDraft(at(draft, h, draft.getMinutes()))}>
              {h}
            </button>
          ))}
        </div>
        <span className="rem-time-label">Минуты</span>
        <div className="rem-minutes">
          {MINUTES.map((m) => (
            <button key={m} type="button" className={`rem-cell${minute === m ? ' rem-on' : ''}`}
              onClick={() => setDraft(at(draft, draft.getHours(), m))}>
              {pad(m)}
            </button>
          ))}
        </div>
      </div>

      <p className={`rem-summary${draft < now ? ' rem-past' : ''}`}>
        {describeReminder(draft, now)}{draft < now && ' — это время уже прошло'}
      </p>
      <div className="actions">
        {value && <button type="button" className="btn btn-danger rem-remove" onClick={() => { onRemove(); onClose(); }}>Убрать</button>}
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-primary" onClick={() => save(draft)}>Готово</button>
      </div>
    </Modal>
  );
}

/**
 * Expanded reminder; `value` is in the datetime-local format (see toInputValue), '' for none.
 * Opens its dialog right away when added; «Убрать» or cancelling without a value calls `onCollapse`.
 */
export default function ReminderField({ value, onChange, onCollapse }) {
  const [open, setOpen] = useState(!value);
  const close = () => {
    setOpen(false);
    if (!value) onCollapse();
  };
  const remove = () => {
    onChange('');
    onCollapse();
  };
  return (
    <div className="field">
      <span className="field-label">Напоминание</span>
      <span className="reminder-input">
        <button type="button" className="select reminder-value" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {value ? describeReminder(new Date(value)) : 'Не задано'}
        </button>
        <button type="button" className="btn btn-small" onClick={remove}>Убрать</button>
      </span>
      {open && createPortal(
        <ReminderDialog value={value} onSave={onChange} onRemove={remove} onClose={close} />,
        document.body,
      )}
    </div>
  );
}

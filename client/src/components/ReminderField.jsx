import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal.jsx';

// The value is local time as "YYYY-MM-DDTHH:mm" (the datetime-local format), '' for none.
const pad = (n) => String(n).padStart(2, '0');
const format = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function toInputValue(ts) {
  return ts ? format(new Date(ts)) : '';
}

export const fromInputValue = (value) => (value ? new Date(value).getTime() : null);

const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 }, (_, m) => m);

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

const ITEM = 36;

/** An iOS-like wheel: scrolls with snapping; the value is the item in the middle band. */
function Wheel({ values, value, onChange, label }) {
  const list = useRef(null);
  const timer = useRef(null);
  const index = values.indexOf(value);

  useLayoutEffect(() => {
    const el = list.current;
    if (Math.round(el.scrollTop / ITEM) !== index) el.scrollTop = index * ITEM;
  }, [index]);

  const onScroll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = values[Math.min(values.length - 1, Math.max(0, Math.round(list.current.scrollTop / ITEM)))];
      if (next !== value) onChange(next);
    }, 90);
  };

  return (
    <div className="rem-wheel" ref={list} onScroll={onScroll} role="listbox" aria-label={label} tabIndex={0}
      onKeyDown={(e) => {
        const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!step) return;
        e.preventDefault();
        onChange(values[Math.min(values.length - 1, Math.max(0, index + step))]);
      }}>
      {values.map((v, i) => (
        <div key={v} role="option" aria-selected={v === value} className={`rem-wheel-item${v === value ? ' rem-on' : ''}`}
          onClick={() => list.current.scrollTo({ top: i * ITEM, behavior: 'smooth' })}>
          {pad(v)}
        </div>
      ))}
    </div>
  );
}

const ChevronIcon = ({ dir = 'right' }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 6 6 6-6 6'} />
  </svg>
);

function Calendar({ value, onChange, now }) {
  const today = startOfDay(now);
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const title = month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/^./, (c) => c.toUpperCase()).replace(/\s*г\.$/, '');
  return (
    <div className="rem-calendar">
      <div className="rem-month">
        <span className="rem-month-name">{title}</span>
        <button type="button" className="rem-nav" aria-label="Предыдущий месяц"
          disabled={month <= new Date(today.getFullYear(), today.getMonth(), 1)} onClick={() => shift(-1)}>
          <ChevronIcon dir="left" />
        </button>
        <button type="button" className="rem-nav" aria-label="Следующий месяц" onClick={() => shift(1)}>
          <ChevronIcon />
        </button>
      </div>
      <div className="rem-grid">
        {WEEKDAYS.map((d) => <span key={d} className="rem-weekday">{d}</span>)}
        {monthDays(month).map((day, i) => (day ? (
          <button key={i} type="button" disabled={day < today}
            className={`rem-day${sameDay(day, value) ? ' rem-on' : ''}${sameDay(day, now) ? ' rem-today' : ''}`}
            onClick={() => onChange(at(day, value.getHours(), value.getMinutes()))}>
            {day.getDate()}
          </button>
        ) : <span key={i} />))}
      </div>
    </div>
  );
}

/** A row of the iOS-like list: the title, the value under it; pressing it unfolds `children`. */
function PickerRow({ label, value, open, onToggle, children }) {
  return (
    <li className="rem-row">
      <button type="button" className="rem-row-head" aria-expanded={open} onClick={onToggle}>
        <span className="rem-row-label">{label}</span>
        <span className="rem-row-value">{value}</span>
      </button>
      {open && <div className="rem-row-body">{children}</div>}
    </li>
  );
}

function ReminderDialog({ value, onSave, onRemove, onClose }) {
  const now = new Date();
  const [draft, setDraft] = useState(() => (value ? new Date(value) : at(addDays(startOfDay(now), 1), 9)));
  const [open, setOpen] = useState('date');
  const toggle = (part) => setOpen(open === part ? null : part);
  const save = (date) => {
    onSave(format(date));
    onClose();
  };
  const dateText = describeReminder(draft, now).replace(/, \d+:\d+$/, '');

  return (
    <Modal title="Напоминание" onClose={onClose} className="reminder-dialog" closeButton>
      <div className="rem-presets">
        {presets(now).map((p) => (
          <button key={p.label} type="button" className="rem-preset" onClick={() => save(p.date)}>
            {p.label}
            <span className="rem-preset-when">{describeReminder(p.date, now)}</span>
          </button>
        ))}
      </div>

      <ul className="rem-rows">
        <PickerRow label="Дата" value={dateText} open={open === 'date'} onToggle={() => toggle('date')}>
          <Calendar value={draft} onChange={setDraft} now={now} />
        </PickerRow>
        <PickerRow label="Время" value={`${pad(draft.getHours())}:${pad(draft.getMinutes())}`} open={open === 'time'}
          onToggle={() => toggle('time')}>
          <div className="rem-wheels">
            <span className="rem-wheel-band" aria-hidden="true" />
            <Wheel label="Часы" values={HOURS} value={draft.getHours()}
              onChange={(h) => setDraft((d) => at(d, h, d.getMinutes()))} />
            <span className="rem-wheel-colon" aria-hidden="true">:</span>
            <Wheel label="Минуты" values={MINUTES} value={draft.getMinutes()}
              onChange={(m) => setDraft((d) => at(d, d.getHours(), m))} />
          </div>
        </PickerRow>
      </ul>

      {draft < now && <p className="rem-past">Это время уже прошло</p>}
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

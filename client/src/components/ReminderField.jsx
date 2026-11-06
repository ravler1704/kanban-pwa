import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_REMINDERS, REPEAT_LABELS, REPEATS, makeReminder, nextTime } from '../reminders.js';
import Modal from './Modal.jsx';

const pad = (n) => String(n).padStart(2, '0');

const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
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

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const RepeatIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

/** «Завтра, 9:00 · Ежедневно»: the reminder's next time (or its past one) and repeat. */
export function reminderText(r, now = new Date()) {
  const text = describeReminder(new Date(nextTime(r, now.getTime()) ?? r.at), now);
  return r.repeat ? `${text} · ${REPEAT_LABELS[r.repeat]}` : text;
}

/** `value`: the reminder being edited, null for a new one. */
function ReminderDialog({ value, onSave, onRemove, onClose }) {
  const now = new Date();
  const [draft, setDraft] = useState(() => (value
    ? new Date(nextTime(value, now.getTime()) ?? value.at)
    : at(addDays(startOfDay(now), 1), 9)));
  const [repeat, setRepeat] = useState(value?.repeat ?? null);
  const [open, setOpen] = useState('date');
  const toggle = (part) => setOpen(open === part ? null : part);
  const save = (date) => {
    onSave(makeReminder(date.getTime(), repeat));
    onClose();
  };
  const dateText = describeReminder(draft, now).replace(/, \d+:\d+$/, '');

  return (
    <Modal title={value ? 'Напоминание' : 'Новое напоминание'} onClose={onClose} className="reminder-dialog" closeButton>
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
        <li className="rem-row">
          <label className="rem-row-head rem-time">
            <span className="rem-row-label">Время</span>
            <input type="time" className="rem-time-input" required value={`${pad(draft.getHours())}:${pad(draft.getMinutes())}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (Number.isInteger(h) && Number.isInteger(m)) setDraft((d) => at(d, h, m));
              }} />
          </label>
        </li>
        <PickerRow label="Повтор" value={repeat ? REPEAT_LABELS[repeat] : 'Никогда'} open={open === 'repeat'}
          onToggle={() => toggle('repeat')}>
          <div className="rem-repeats" role="radiogroup" aria-label="Повтор">
            {[null, ...REPEATS].map((r) => (
              <button key={r ?? 'none'} type="button" role="radio" aria-checked={r === repeat}
                className={`rem-repeat${r === repeat ? ' rem-on' : ''}`} onClick={() => setRepeat(r)}>
                {r ? REPEAT_LABELS[r] : 'Никогда'}
                {r === repeat && <CheckIcon />}
              </button>
            ))}
          </div>
        </PickerRow>
      </ul>

      {!repeat && draft < now && <p className="rem-past">Это время уже прошло</p>}
      <div className="actions">
        {value && <button type="button" className="btn btn-danger rem-remove" onClick={() => { onRemove(); onClose(); }}>Удалить</button>}
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-primary" onClick={() => save(draft)}>Готово</button>
      </div>
    </Modal>
  );
}

/**
 * The card's reminders (see reminders.js), any number of them. Opens the dialog right away when
 * added; removing the last one or cancelling the first calls `onCollapse`.
 */
export default function ReminderField({ value, onChange, onCollapse }) {
  // The index of the reminder being edited, 'new', or null.
  const [editing, setEditing] = useState(value.length ? null : 'new');
  const now = new Date();
  const close = () => {
    setEditing(null);
    if (!value.length) onCollapse();
  };
  const save = (reminder) => {
    const next = editing === 'new' ? [...value, reminder] : value.map((r, i) => (i === editing ? reminder : r));
    onChange(next.sort((a, b) => a.at - b.at));
  };
  const remove = (index) => {
    const next = value.filter((_, i) => i !== index);
    onChange(next);
    if (!next.length) onCollapse();
  };
  return (
    <div className="field">
      <span className="field-label">{value.length > 1 ? 'Напоминания' : 'Напоминание'}</span>
      <ul className="reminder-list">
        {value.map((r, i) => (
          <li key={`${r.at}-${r.repeat}-${i}`} className="reminder-input">
            <button type="button" aria-haspopup="dialog" onClick={() => setEditing(i)}
              className={`select reminder-value${!r.repeat && r.at < now ? ' reminder-past' : ''}`}>
              {r.repeat && <RepeatIcon />}
              {reminderText(r, now)}
            </button>
            <button type="button" className="btn btn-small" onClick={() => remove(i)}>Убрать</button>
          </li>
        ))}
      </ul>
      {value.length > 0 && value.length < MAX_REMINDERS && (
        <button type="button" className="btn btn-small reminder-add" onClick={() => setEditing('new')}>
          + Ещё напоминание
        </button>
      )}
      {editing !== null && createPortal(
        <ReminderDialog value={editing === 'new' ? null : value[editing]} onSave={save}
          onRemove={() => remove(editing)} onClose={close} />,
        document.body,
      )}
    </div>
  );
}

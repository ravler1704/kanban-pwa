import { useState } from 'react';
import { createPortal } from 'react-dom';
import { describeDeadline, endOfDay } from '../deadlines.js';
import { describeReminder } from './ReminderField.jsx';
import Modal from './Modal.jsx';

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function presets(now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [
    { label: 'Сегодня', date: today },
    { label: 'Завтра', date: addDays(today, 1) },
    { label: 'Через неделю', date: addDays(today, 7) },
    { label: 'Через месяц', date: addDays(today, 30) },
  ];
}

function DeadlineDialog({ value, onSave, onRemove, onClose }) {
  const now = new Date();
  const initial = value ? new Date(value) : addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
  const [draft, setDraft] = useState(initial);
  const dateOnly = `${draft.getFullYear()}-${String(draft.getMonth() + 1).padStart(2, '0')}-${String(draft.getDate()).padStart(2, '0')}`;
  const pick = (d) => {
    setDraft(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  };
  const save = (d) => onSave(endOfDay(d));

  return (
    <Modal title={value ? 'Дедлайн' : 'Новый дедлайн'} onClose={onClose} className="reminder-dialog" closeButton>
      <div className="rem-presets">
        {presets(now).map((p) => (
          <button key={p.label} type="button" className="rem-preset" onClick={() => { save(p.date); onClose(); }}>
            {p.label}
            <span className="rem-preset-when">{describeDeadline(endOfDay(p.date), now)}</span>
          </button>
        ))}
      </div>
      <label className="field rem-deadline-date">
        <span className="field-label">Дата</span>
        <input type="date" className="input" value={dateOnly}
          onChange={(e) => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split('-').map(Number);
            pick(new Date(y, m - 1, d));
          }} />
        <span className="muted rem-deadline-hint">{describeReminder(draft, now).replace(/, \d+:\d+$/, '')}</span>
      </label>
      {draft < startOfDay(now) && <p className="rem-past">Этот день уже прошёл</p>}
      <div className="actions">
        {value != null && (
          <button type="button" className="btn btn-danger rem-remove" onClick={() => { onRemove(); onClose(); }}>
            Убрать дедлайн
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-primary" onClick={() => { save(draft); onClose(); }}>Готово</button>
      </div>
    </Modal>
  );
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** One deadline per card (end of the chosen day). Opens the dialog when added; clearing calls `onCollapse`. */
export default function DeadlineField({ value, onChange, onCollapse }) {
  const [open, setOpen] = useState(value == null);
  const now = new Date();
  const close = () => {
    setOpen(false);
    if (value == null) onCollapse();
  };
  return (
    <div className="field">
      <span className="field-label">Дедлайн</span>
      <div className="reminder-input">
        <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
          className={`select reminder-value deadline-value${value != null && value < now.getTime() ? ' reminder-past' : ''}`}>
          {value != null ? describeDeadline(value, now) : 'Выберите дату'}
        </button>
        {value != null && (
          <button type="button" className="btn btn-small" onClick={() => { onChange(null); onCollapse(); }}>Убрать</button>
        )}
      </div>
      {open && createPortal(
        <DeadlineDialog value={value} onSave={onChange} onRemove={() => onChange(null)}
          onClose={close} />,
        document.body,
      )}
    </div>
  );
}

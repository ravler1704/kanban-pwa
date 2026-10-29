import { useState } from 'react';
import { deleteCard, moveCardToEnd, moveCardToSection, updateCard } from '../actions.js';
import { enablePush, PUSH_HINTS, pushState } from '../push.js';
import Modal from './Modal.jsx';

// <input type="datetime-local"> works with local time as "YYYY-MM-DDTHH:mm".
function toInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fromInputValue = (value) => (value ? new Date(value).getTime() : null);

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

/** `sections` are the live sections of the card's project. */
export default function CardEditor({ card, columns, sections, onClose }) {
  // Snapshot of the card when the editor opened, used to detect concurrent remote edits.
  const [base] = useState(() => ({ title: card.title, description: card.description }));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [sectionId, setSectionId] = useState(card.sectionId ?? '');
  const [columnId, setColumnId] = useState(card.columnId);
  const [remindAt, setRemindAt] = useState(() => toInputValue(card.remindAt));

  const changedRemotely = card.title !== base.title || card.description !== base.description;

  async function save(e) {
    e.preventDefault();
    const patch = {};
    if (title !== base.title) patch.title = title;
    if (description !== base.description) patch.description = description;
    if (remindAt !== toInputValue(card.remindAt)) patch.remindAt = fromInputValue(remindAt);
    if (Object.keys(patch).length) await updateCard(card.id, patch, base);
    if ((sectionId || null) !== card.sectionId) await moveCardToSection(card.id, sectionId || null);
    if (columnId !== card.columnId) await moveCardToEnd(card.id, columnId);
    onClose();
  }

  async function remove() {
    if (!confirm('Удалить карточку?')) return;
    await deleteCard(card.id);
    onClose();
  }

  return (
    <Modal title="Карточка" onClose={onClose}>
      <form className="editor" onSubmit={save}>
        {changedRemotely && (
          <p className="notice">
            Пока вы редактировали, карточку изменили на другом устройстве. При сохранении
            пересекающиеся правки попадут в окно разрешения конфликта.
          </p>
        )}
        <label>
          Название
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus />
        </label>
        <label>
          Описание
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} maxLength={10000} />
        </label>
        <label>
          Статус
          <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Напоминание
          <span className="reminder-input">
            <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
            {remindAt && (
              <button type="button" className="btn btn-small" onClick={() => setRemindAt('')}>Убрать</button>
            )}
          </span>
        </label>
        {remindAt && <ReminderPushStatus />}
        {sections.length > 0 && (
          <label>
            Раздел
            <select className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Не выбран</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <div className="actions">
          <button type="button" className="btn btn-danger" onClick={remove}>Удалить</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

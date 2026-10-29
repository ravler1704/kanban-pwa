import { useState } from 'react';
import { deleteCard, moveCardToEnd, moveCardToSection, updateCard } from '../actions.js';
import DescriptionField from './DescriptionField.jsx';
import Modal from './Modal.jsx';
import ReminderField, { fromInputValue, toInputValue } from './ReminderField.jsx';

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
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
        </label>
        <DescriptionField value={description} onChange={setDescription} />
        <label>
          Статус
          <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <ReminderField value={remindAt} onChange={setRemindAt} />
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

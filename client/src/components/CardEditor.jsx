import { useState } from 'react';
import { deleteCard, moveCardToEnd, moveCardToGroup, updateCard } from '../actions.js';
import CardExtraFields from './CardExtraFields.jsx';
import Modal from './Modal.jsx';
import { GroupSelect } from './NewCardDialog.jsx';
import { fromInputValue, toInputValue } from './ReminderField.jsx';

/** `groups` are the projects with their sections ({ project, sections }) the card can be moved to. */
export default function CardEditor({ card, columns, groups, onClose }) {
  // Snapshot of the card when the editor opened, used to detect concurrent remote edits.
  const [base] = useState(() => ({ title: card.title, description: card.description }));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [group, setGroup] = useState({ projectId: card.projectId, sectionId: card.sectionId ?? null });
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
    await moveCardToGroup(card.id, group);
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
        <CardExtraFields
          description={description}
          onDescription={setDescription}
          remindAt={remindAt}
          onRemindAt={setRemindAt}
        />
        <GroupSelect groups={groups} value={group} onChange={setGroup} />
        <label>
          Статус
          <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
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

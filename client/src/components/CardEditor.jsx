import { useState } from 'react';
import { deleteCard, moveCardToColumn, moveCardToFolder, updateCard } from '../actions.js';
import Attachments from './Attachments.jsx';
import CardExtraFields from './CardExtraFields.jsx';
import CardPeople from './CardPeople.jsx';
import Comments from './Comments.jsx';
import Markdown from './Markdown.jsx';
import Modal from './Modal.jsx';
import FolderSelect from './FolderSelect.jsx';
import { matchColumn } from '../columnSets.js';
import { folderPathName } from '../folders.js';
import { cardReminders } from '../reminders.js';
import { reminderText } from './ReminderField.jsx';
import TitleField from './TitleField.jsx';

/** Comments sent right away, apart from the card's «Сохранить», among the notes of what was done with it. */
function CardComments({ card }) {
  return <Comments card={card} title="Комментарии" className="chat-embedded" />;
}

/** The card without editing: a view-only public link. */
function CardView({ card, columnsOfFolder, folders, onClose }) {
  const column = columnsOfFolder(card.folderId).find((c) => c.id === card.columnId);
  const folder = folders.find((f) => f.id === card.folderId);
  return (
    <Modal title={card.number ? `Карточка #${card.number}` : 'Карточка'} onClose={onClose}>
      <div className="editor card-view">
        <h3 className="card-view-title">
          {card.title ? <Markdown text={card.title} inline /> : <em className="muted">Без названия</em>}
        </h3>
        <p className="muted">
          {[column?.name, folder && folderPathName(folder, folders)].filter(Boolean).join(' · ')}
          {cardReminders(card).length > 0
            && ` · напоминания: ${cardReminders(card).map((r) => reminderText(r)).join('; ')}`}
        </p>
        {card.description && <div className="card-view-desc"><Markdown text={card.description} /></div>}
        <CardPeople folderId={card.folderId} authorId={card.authorId} assigneeId={card.assigneeId} />
        <Attachments card={card} readOnly />
        <CardComments card={card} />
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * `folders` are the folders the card can be moved to.
 * `readOnly`: the card is only shown.
 */
export default function CardEditor({ readOnly, ...props }) {
  return readOnly ? <CardView {...props} /> : <CardForm {...props} />;
}

function CardForm({ card, columnsOfFolder, folders, onClose }) {
  // Snapshot of the card when the editor opened, used to detect concurrent remote edits.
  const [base] = useState(() => ({ title: card.title, description: card.description }));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [folderId, setFolderId] = useState(card.folderId);
  const [columnId, setColumnId] = useState(card.columnId);
  const [reminders, setReminders] = useState(() => cardReminders(card));
  const [authorId, setAuthorId] = useState(card.authorId ?? null);
  const [assigneeId, setAssigneeId] = useState(card.assigneeId ?? null);

  // Another folder may use another column set: the status then is one of its columns.
  const columns = columnsOfFolder(folderId);
  const ownColumns = columnsOfFolder(card.folderId);
  const otherSet = columns.map((c) => c.id).join() !== ownColumns.map((c) => c.id).join();

  function changeFolder(next) {
    const nextColumns = columnsOfFolder(next);
    if (!nextColumns.some((c) => c.id === columnId)) {
      setColumnId(matchColumn(ownColumns.find((c) => c.id === columnId), nextColumns)?.id ?? columnId);
    }
    setFolderId(next);
  }

  const changedRemotely = card.title !== base.title || card.description !== base.description;

  async function save(e) {
    e.preventDefault();
    const patch = {};
    if (title !== base.title) patch.title = title;
    if (description !== base.description) patch.description = description;
    if (JSON.stringify(reminders) !== JSON.stringify(cardReminders(card))) {
      patch.reminders = reminders;
      patch.remindAt = null;
    }
    if (authorId !== (card.authorId ?? null)) patch.authorId = authorId;
    if (assigneeId !== (card.assigneeId ?? null)) patch.assigneeId = assigneeId;
    if (Object.keys(patch).length) await updateCard(card.id, patch, base);
    await moveCardToFolder(card.id, folderId);
    if (columnId !== card.columnId) await moveCardToColumn(card.id, columnId);
    onClose();
  }

  async function remove() {
    if (!confirm('Удалить карточку?')) return;
    await deleteCard(card.id);
    onClose();
  }

  return (
    <Modal title={card.number ? `Карточка #${card.number}` : 'Карточка'} onClose={onClose}>
      <form className="editor" onSubmit={save}>
        {changedRemotely && (
          <p className="notice">
            Пока вы редактировали, карточку изменили на другом устройстве. При сохранении
            пересекающиеся правки попадут в окно разрешения конфликта.
          </p>
        )}
        <TitleField value={title} onChange={setTitle} />
        <label className="field">
          <span className="field-label">Статус</span>
          <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <CardExtraFields
          description={description}
          onDescription={setDescription}
          reminders={reminders}
          onReminders={setReminders}
          card={card}
        />
        <FolderSelect folders={folders} value={folderId} onChange={changeFolder} />
        {otherSet && (
          <p className="notice">
            У этой папки другой набор колонок — проверьте статус, в который попадёт карточка.
          </p>
        )}
        <CardPeople folderId={folderId} authorId={authorId} assigneeId={assigneeId}
          onAuthor={setAuthorId} onAssignee={setAssigneeId} />
        <div className="actions">
          <button type="button" className="btn btn-danger" onClick={remove}>Удалить</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
      <CardComments card={card} />
    </Modal>
  );
}

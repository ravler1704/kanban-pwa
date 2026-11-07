import { useContext, useState } from 'react';
import { DoneMarks } from '../doneMarks.js';
import { moveCardTo, moveCardToColumn, moveCardToFolder, updateCard } from '../actions.js';
import { CARD_COLORS } from '../appearance.js';
import { INBOX_ID } from '../db.js';
import { ICONS } from '../menuIcons.js';
import { ButtonIcon } from './ArchiveDialog.jsx';
import { archiveWithUndo } from './UndoToast.jsx';
import Attachments from './Attachments.jsx';
import { DoneButton } from './Card.jsx';
import CardExtraFields from './CardExtraFields.jsx';
import Checklist from './Checklist.jsx';
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

/** The cover colour: «none» and the palette. */
function ColorField({ value, onChange }) {
  return (
    <div className="field">
      <div className="color-swatches" role="radiogroup" aria-label="Цвет карточки">
        <button type="button" role="radio" aria-checked={!value} title="Без цвета" aria-label="Без цвета"
          className={`color-swatch color-swatch-none ${!value ? 'color-swatch-on' : ''}`} onClick={() => onChange(null)} />
        {CARD_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={value === c.id} title={c.name} aria-label={c.name}
            className={`color-swatch ${value === c.id ? 'color-swatch-on' : ''}`} style={{ background: c.value }}
            onClick={() => onChange(c.id)} />
        ))}
      </div>
    </div>
  );
}

/** The card without editing: a view-only public link. */
function CardView({ card, columnsOfFolder, folders, onClose }) {
  const column = columnsOfFolder(card.folderId).find((c) => c.id === card.columnId);
  const folder = folders.find((f) => f.id === card.folderId);
  const doneMarks = useContext(DoneMarks)(card);
  return (
    <Modal title={card.number ? `Карточка #${card.number}` : 'Карточка'} onClose={onClose}
      headerEnd={card.done && doneMarks && <DoneButton card={card} readOnly className="modal-done-btn" />}>
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
        <Checklist card={card} readOnly />
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
 * `folders` are the folders the card can be moved to; with `inbox`, «Входящие» too.
 * `readOnly`: the card is only shown.
 */
export default function CardEditor({ readOnly, ...props }) {
  return readOnly ? <CardView {...props} /> : <CardForm {...props} />;
}

function CardForm({ card, columnsOfFolder, folders, inbox, onClose }) {
  // Snapshot of the card when the editor opened, used to detect concurrent remote edits.
  const [base] = useState(() => ({ title: card.title, description: card.description }));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [folderId, setFolderId] = useState(card.folderId);
  const [columnId, setColumnId] = useState(card.columnId);
  const [reminders, setReminders] = useState(() => cardReminders(card));
  const [authorId, setAuthorId] = useState(card.authorId ?? null);
  const [assigneeId, setAssigneeId] = useState(card.assigneeId ?? null);
  const [color, setColor] = useState(card.color ?? null);
  const doneMarks = useContext(DoneMarks)(card);

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
    if (color !== (card.color ?? null)) patch.color = color;
    if (Object.keys(patch).length) await updateCard(card.id, patch, base);
    if (folderId !== card.folderId && (folderId === INBOX_ID || card.folderId === INBOX_ID)) {
      await moveCardTo(card.id, folderId, columnId);
    } else {
      await moveCardToFolder(card.id, folderId);
      if (columnId !== card.columnId) await moveCardToColumn(card.id, columnId);
    }
    onClose();
  }

  async function remove() {
    await archiveWithUndo([card.id]);
    onClose();
  }

  return (
    <Modal title={card.number ? `Карточка #${card.number}` : 'Карточка'} onClose={onClose}
      headerEnd={doneMarks && <DoneButton card={card} readOnly={card.conflict} className="modal-done-btn" />}>
      <form className="editor" onSubmit={save}>
        {changedRemotely && (
          <p className="notice">
            Пока вы редактировали, карточку изменили на другом устройстве. При сохранении
            пересекающиеся правки попадут в окно разрешения конфликта.
          </p>
        )}
        <TitleField value={title} onChange={setTitle} />
        {folderId !== INBOX_ID && (
          <label className="field">
            <span className="field-label">Статус</span>
            <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <CardExtraFields
          description={description}
          onDescription={setDescription}
          reminders={reminders}
          onReminders={setReminders}
          card={card}
        />
        {inbox ? (
          <FolderSelect folders={folders} value={folderId === INBOX_ID ? '' : folderId} topLabel="Входящие"
            onChange={(next) => changeFolder(next || INBOX_ID)} />
        ) : <FolderSelect folders={folders} value={folderId} onChange={changeFolder} />}
        {otherSet && folderId !== INBOX_ID && card.folderId !== INBOX_ID && (
          <p className="notice">
            У этой доски другой набор колонок — проверьте статус, в который попадёт карточка.
          </p>
        )}
        <CardPeople folderId={folderId} authorId={authorId} assigneeId={assigneeId}
          onAuthor={setAuthorId} onAssignee={setAssigneeId} />
        {folderId !== INBOX_ID && <ColorField value={color} onChange={setColor} />}
        <div className="actions">
          <button type="button" className="btn btn-labeled" onClick={remove}>
            <ButtonIcon path={ICONS.archive} />Архивировать
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
      <CardComments card={card} />
    </Modal>
  );
}

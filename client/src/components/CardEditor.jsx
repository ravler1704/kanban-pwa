import { useState } from 'react';
import { deleteCard, moveCardToColumn, moveCardToGroup, updateCard } from '../actions.js';
import Attachments from './Attachments.jsx';
import CardExtraFields from './CardExtraFields.jsx';
import Comments from './Comments.jsx';
import Linkified from './Linkified.jsx';
import Modal from './Modal.jsx';
import { GroupSelect } from './NewCardDialog.jsx';
import { matchColumn } from '../columnSets.js';
import { fromInputValue, toInputValue } from './ReminderField.jsx';
import TitleField from './TitleField.jsx';

/** Comments sent right away, apart from the card's «Сохранить», among the notes of what was done with it. */
function CardComments({ card }) {
  return <Comments card={card} title="Комментарии" className="chat-embedded" />;
}

/** The card without editing: a view-only public link. */
function CardView({ card, columnsOfProject, groups, onClose }) {
  const column = columnsOfProject(card.projectId).find((c) => c.id === card.columnId);
  const section = groups.find((g) => g.project.id === card.projectId)?.sections.find((s) => s.id === card.sectionId);
  return (
    <Modal title={card.number ? `Карточка #${card.number}` : 'Карточка'} onClose={onClose}>
      <div className="editor card-view">
        <h3 className="card-view-title">
          {card.title ? <Linkified text={card.title} /> : <em className="muted">Без названия</em>}
        </h3>
        <p className="muted">
          {[column?.name, section?.name].filter(Boolean).join(' · ')}
          {card.remindAt && ` · напоминание ${new Date(card.remindAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          })}`}
        </p>
        {card.description && <p className="card-view-desc"><Linkified text={card.description} /></p>}
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
 * `groups` are the projects with their sections ({ project, sections }) the card can be moved to.
 * `readOnly`: the card is only shown.
 */
export default function CardEditor({ readOnly, ...props }) {
  return readOnly ? <CardView {...props} /> : <CardForm {...props} />;
}

function CardForm({ card, columnsOfProject, groups, onClose }) {
  // Snapshot of the card when the editor opened, used to detect concurrent remote edits.
  const [base] = useState(() => ({ title: card.title, description: card.description }));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [group, setGroup] = useState({ projectId: card.projectId, sectionId: card.sectionId ?? null });
  const [columnId, setColumnId] = useState(card.columnId);
  const [remindAt, setRemindAt] = useState(() => toInputValue(card.remindAt));

  // Another project may use another column set: the status then is one of its columns.
  const columns = columnsOfProject(group.projectId);
  const ownColumns = columnsOfProject(card.projectId);
  const otherSet = columns.map((c) => c.id).join() !== ownColumns.map((c) => c.id).join();

  function changeGroup(next) {
    const nextColumns = columnsOfProject(next.projectId);
    if (!nextColumns.some((c) => c.id === columnId)) {
      setColumnId(matchColumn(ownColumns.find((c) => c.id === columnId), nextColumns)?.id ?? columnId);
    }
    setGroup(next);
  }

  const changedRemotely = card.title !== base.title || card.description !== base.description;

  async function save(e) {
    e.preventDefault();
    const patch = {};
    if (title !== base.title) patch.title = title;
    if (description !== base.description) patch.description = description;
    if (remindAt !== toInputValue(card.remindAt)) patch.remindAt = fromInputValue(remindAt);
    if (Object.keys(patch).length) await updateCard(card.id, patch, base);
    await moveCardToGroup(card.id, group);
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
          remindAt={remindAt}
          onRemindAt={setRemindAt}
          card={card}
        />
        <GroupSelect groups={groups} value={group} onChange={changeGroup} />
        {otherSet && (
          <p className="notice">
            У этого проекта другой набор колонок — проверьте статус, в который попадёт карточка.
          </p>
        )}
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

import { useState } from 'react';
import { createCard } from '../actions.js';
import CardExtraFields from './CardExtraFields.jsx';
import Modal from './Modal.jsx';
import { fromInputValue } from './ReminderField.jsx';

const LAST_KEY = 'lastTargetForNewCard';

const encode = (projectId, sectionId) => `${projectId}|${sectionId ?? ''}`;
const decode = (value) => {
  const [projectId, sectionId] = value.split('|');
  return { projectId, sectionId: sectionId || null };
};

/** "Project / section" select; `value` and `onChange` use { projectId, sectionId }. */
export function GroupSelect({ groups, value, onChange }) {
  return (
    <label>
      Проект / раздел
      <select className="select" value={encode(value.projectId, value.sectionId)} onChange={(e) => onChange(decode(e.target.value))}>
        {groups.flatMap((g) => [
          <option key={g.project.id} value={encode(g.project.id, null)}>{g.project.name}</option>,
          ...g.sections.map((s) => (
            <option key={s.id} value={encode(g.project.id, s.id)}>{g.project.name} / {s.name}</option>
          )),
        ])}
      </select>
    </label>
  );
}

const encodeAll = (groups) =>
  groups.flatMap((g) => [encode(g.project.id, null), ...g.sections.map((s) => encode(g.project.id, s.id))]);

/** Where a new card goes when no project is selected: the last used destination, or the first project. */
export function defaultTarget(groups) {
  const values = encodeAll(groups);
  const last = localStorage.getItem(LAST_KEY);
  const value = values.includes(last) ? last : values[0];
  return value ? decode(value) : null;
}

/**
 * `target` ({ projectId, sectionId }) is the current selection; when null (all projects
 * are shown) the last used destination is preselected.
 */
export default function NewCardDialog({ groups, columns, target, onClose }) {
  const [where, setWhere] = useState(() => {
    const preferred = target ?? defaultTarget(groups);
    return preferred ? encode(preferred.projectId, preferred.sectionId) : '';
  });
  // New cards land in «Входящие» (the default backlog column), or the first column if it was removed.
  const [columnId, setColumnId] = useState((columns.find((c) => c.id === 'backlog') ?? columns[0]).id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [remindAt, setRemindAt] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !where) return;
    localStorage.setItem(LAST_KEY, where);
    await createCard(decode(where), columnId, title.trim(), description, fromInputValue(remindAt));
    onClose();
  }

  return (
    <Modal title="Новая карточка" onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <label>
          Название
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus />
        </label>
        <CardExtraFields
          description={description}
          onDescription={setDescription}
          remindAt={remindAt}
          onRemindAt={setRemindAt}
          descriptionRows={4}
        />
        <GroupSelect groups={groups} value={decode(where)} onChange={(v) => setWhere(encode(v.projectId, v.sectionId))} />
        <label>
          Колонка
          <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Добавить</button>
        </div>
      </form>
    </Modal>
  );
}

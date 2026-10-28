import { useState } from 'react';
import {
  countCards, countColumnCards, createColumn, createProject, createSection, deleteColumn, deleteProject,
  deleteSection, moveColumn, renameColumn, renameProject, renameSection,
} from '../actions.js';
import Modal from './Modal.jsx';

/** Text input that saves on Enter / blur and reverts on Escape. */
function NameInput({ value, onSave, className = '', ariaLabel, maxLength = 200 }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // Renamed elsewhere (e.g. synced from another device).
    setPrev(value);
    setDraft(value);
  }

  function commit() {
    const name = draft.trim();
    if (name && name !== value) onSave(name);
    else setDraft(value);
  }

  return (
    <input
      className={`manage-input ${className}`}
      value={draft}
      aria-label={ariaLabel}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

function AddForm({ placeholder, onAdd }) {
  const [name, setName] = useState('');
  return (
    <form
      className="manage-add"
      onSubmit={(e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        onAdd(value);
        setName('');
      }}
    >
      <input
        className="manage-input"
        value={name}
        placeholder={placeholder}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn btn-small" disabled={!name.trim()}>Добавить</button>
    </form>
  );
}

/** Deleting a column that still has cards: they move to the chosen column. */
function DeleteColumnDialog({ column, count, columns, onClose }) {
  const others = columns.filter((c) => c.id !== column.id);
  const [targetId, setTargetId] = useState(others[0].id);

  async function submit(e) {
    e.preventDefault();
    await deleteColumn(column.id, targetId);
    onClose();
  }

  return (
    <Modal title="Удалить колонку" onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <p>В колонке «{column.name}» карточек: {count}. Куда их перенести?</p>
        <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-danger">Перенести и удалить</button>
        </div>
      </form>
    </Modal>
  );
}

function ColumnsEditor({ columns, synced }) {
  const [deleting, setDeleting] = useState(null);

  if (!synced) {
    return <p className="muted">Колонки можно будет изменить после первой синхронизации с сервером.</p>;
  }

  async function remove(column) {
    const count = await countColumnCards(column.id);
    if (count > 0) setDeleting({ column, count });
    else if (confirm(`Удалить колонку «${column.name}»?`)) await deleteColumn(column.id, null);
  }

  return (
    <div className="manage-columns">
      {columns.map((c, i) => (
        <div key={c.id} className="manage-row">
          <NameInput value={c.name} ariaLabel="Название колонки" maxLength={100}
            onSave={(name) => renameColumn(c.id, name)} />
          <button className="btn btn-small" title="Выше" aria-label="Выше" disabled={i === 0}
            onClick={() => moveColumn(c.id, -1)}>↑</button>
          <button className="btn btn-small" title="Ниже" aria-label="Ниже" disabled={i === columns.length - 1}
            onClick={() => moveColumn(c.id, 1)}>↓</button>
          <button className="btn btn-small btn-danger" disabled={columns.length === 1}
            title={columns.length === 1 ? 'Нужна хотя бы одна колонка' : undefined}
            onClick={() => remove(c)}>Удалить</button>
        </div>
      ))}
      <AddForm placeholder="Новая колонка" onAdd={createColumn} />
      {deleting && (
        <DeleteColumnDialog column={deleting.column} count={deleting.count} columns={columns}
          onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

export default function ManageDialog({ columns, columnsSynced, projects, sections, onClose }) {
  const [deleting, setDeleting] = useState(null);

  async function removeProject(project) {
    if (!confirm(`Удалить проект «${project.name}» со всеми разделами и карточками?`)) return;
    await deleteProject(project.id);
  }

  async function removeSection(section) {
    const count = await countCards(section.projectId, section.id);
    if (count > 0) {
      setDeleting({ section, count });
    } else if (confirm(`Удалить раздел «${section.name}»?`)) {
      await deleteSection(section.id, { keepCards: false });
    }
  }

  async function finishDelete(keepCards) {
    await deleteSection(deleting.section.id, { keepCards });
    setDeleting(null);
  }

  return (
    <Modal title="Настройки доски" onClose={onClose}>
      <div className="manage">
        <h4 className="manage-heading">Проекты и разделы</h4>
        {projects.length === 0 && <p className="muted">Пока нет ни одного проекта.</p>}
        {projects.map((p) => (
          <section key={p.id} className="manage-project">
            <div className="manage-row">
              <NameInput value={p.name} className="manage-project-name" ariaLabel="Название проекта"
                onSave={(name) => renameProject(p.id, name)} />
              <button className="btn btn-small btn-danger" onClick={() => removeProject(p)}>Удалить</button>
            </div>
            <div className="manage-sections">
              {sections.filter((s) => s.projectId === p.id).map((s) => (
                <div key={s.id} className="manage-row">
                  <NameInput value={s.name} ariaLabel="Название раздела"
                    onSave={(name) => renameSection(s.id, name)} />
                  <button className="btn btn-small btn-danger" onClick={() => removeSection(s)}>Удалить</button>
                </div>
              ))}
              <AddForm placeholder="Новый раздел" onAdd={(name) => createSection(p.id, name)} />
            </div>
          </section>
        ))}
        <AddForm placeholder="Новый проект" onAdd={createProject} />
        <h4 className="manage-heading">Колонки</h4>
        <ColumnsEditor columns={columns} synced={columnsSynced} />
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>

      {deleting && (
        <Modal title="Удалить раздел" onClose={() => setDeleting(null)}>
          <p>В разделе «{deleting.section.name}» карточек: {deleting.count}. Что с ними сделать?</p>
          <div className="actions">
            <button className="btn" onClick={() => setDeleting(null)}>Отмена</button>
            <button className="btn" onClick={() => finishDelete(true)}>Оставить в проекте</button>
            <button className="btn btn-danger" onClick={() => finishDelete(false)}>Удалить вместе с карточками</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

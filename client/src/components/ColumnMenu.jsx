import { useCallback, useState } from 'react';
import {
  countColumnCards, deleteColumn, insertColumn, moveColumn, renameColumn, setColumnAddToTop,
} from '../actions.js';
import ContextMenu from './ContextMenu.jsx';
import Modal from './Modal.jsx';

const quoted = (names) => names.map((n) => `«${n}»`).join(', ');

/** Which boards a change of the set's columns reaches, when that is more than the board in view. */
function SetNote({ edit }) {
  if (edit.boards.length < 2) return null;
  return (
    <p className="muted account-hint">
      Набор «{edit.setName}» используют доски: {quoted(edit.boards)}. Изменение применится ко всем.
    </p>
  );
}

function NameDialog({ title, value, submitLabel, edit, onSave, onClose }) {
  const [name, setName] = useState(value);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave(name.trim().slice(0, 100));
    onClose();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <label className="field manage-field">
          <span className="field-label">Название колонки</span>
          <input className="manage-input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        <SetNote edit={edit} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Deleting a column that still has cards: they move to the chosen column. */
function DeleteColumnDialog({ column, count, columns, edit, onClose }) {
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
        <label className="field">
          <span className="field-label">Перенести карточки в</span>
          <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <SetNote edit={edit} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-danger">Перенести и удалить</button>
        </div>
      </form>
    </Modal>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/**
 * The «⋯» menu of a board column. `edit` is { setId, setName, columns, boards: [name], onSetSettings }:
 * the set the column belongs to, its columns in order and the boards using it.
 */
export default function ColumnMenu({ column, edit }) {
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDialog = () => setDialog(null);
  const { columns, setId } = edit;
  const index = columns.findIndex((c) => c.id === column.id);
  const sole = columns.length === 1;

  async function remove() {
    const count = await countColumnCards(column.id);
    if (count > 0) return setDialog({ kind: 'delete', count });
    const note = edit.boards.length > 1 ? ` Колонка пропадёт у досок: ${quoted(edit.boards)}.` : '';
    if (confirm(`Удалить колонку «${column.name}»?${note}`)) await deleteColumn(column.id, null);
    return null;
  }

  const items = [
    { label: 'Переименовать…', run: () => setDialog({ kind: 'rename' }) },
    { label: 'Сдвинуть левее', disabled: index <= 0, run: () => moveColumn(column.id, -1) },
    { label: 'Сдвинуть правее', disabled: index >= columns.length - 1, run: () => moveColumn(column.id, 1) },
    null,
    { label: 'Новые карточки — в начало', active: Boolean(column.addToTop), run: () => setColumnAddToTop(column.id, true) },
    { label: 'Новые карточки — в конец', active: !column.addToTop, run: () => setColumnAddToTop(column.id, false) },
    null,
    { label: 'Добавить колонку слева…', run: () => setDialog({ kind: 'add', at: index }) },
    { label: 'Добавить колонку справа…', run: () => setDialog({ kind: 'add', at: index + 1 }) },
    null,
    { label: 'Набор колонок…', run: edit.onSetSettings },
    null,
    { label: 'Удалить колонку', danger: true, disabled: sole, run: remove },
  ];

  return (
    <>
      <button type="button" className={`btn btn-icon column-menu-btn ${menu ? 'active' : ''}`}
        title="Действия с колонкой" aria-label={`Действия с колонкой «${column.name}»`} aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        onMouseDown={(e) => menu && e.stopPropagation()}
        onClick={(e) => {
          if (menu) return setMenu(null);
          const r = e.currentTarget.getBoundingClientRect();
          return setMenu({ x: r.right - 220, y: r.bottom + 4 });
        }}>
        <MoreIcon />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
      {dialog?.kind === 'rename' && (
        <NameDialog title="Переименовать колонку" value={column.name} submitLabel="Сохранить" edit={edit}
          onSave={(name) => renameColumn(column.id, name)} onClose={closeDialog} />
      )}
      {dialog?.kind === 'add' && (
        <NameDialog title="Новая колонка" value="" submitLabel="Добавить" edit={edit}
          onSave={(name) => insertColumn(setId, name, dialog.at)} onClose={closeDialog} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteColumnDialog column={column} count={dialog.count} columns={columns} edit={edit} onClose={closeDialog} />
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import {
  countColumnCards, deleteColumn, insertColumn, moveColumn, setColumnAddToTop, setColumnWipLimit,
} from '../actions.js';
import WipLimitDialog from './WipLimitDialog.jsx';
import { columnColorItems } from '../appearance.js';
import { ICONS } from '../menuIcons.js';
import ContextMenu, { useHoverShortcuts, useMenuButton } from './ContextMenu.jsx';
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
 * The «⋯» menu of a board column: moving all its cards (`moveAll(column)` to `prevColumn` / `nextColumn`,
 * null when it has none to move), archiving them (`archiveAll()`, null with none, absent when read-only) and, with `edit` ({ setId, setName, columns, boards: [name], onSetSettings }:
 * the set the column belongs to, its columns in order and the boards using it), changing the columns.
 * A right click on `hoverRef` (the column, apart from its cards) opens it too; the shortcuts also work
 * with the pointer over it. A `collapsed` column has no «⋯» button, only the right click.
 */
export default function ColumnMenu({
  column, prevColumn, nextColumn, moveAll, archiveAll, edit, collapsed, onCollapse, hoverRef,
}) {
  const [menu, setMenu, closeMenu, menuButton] = useMenuButton(280);
  const [dialog, setDialog] = useState(null);
  const closeDialog = () => setDialog(null);
  const columns = edit?.columns ?? [];
  const index = columns.findIndex((c) => c.id === column.id);
  const sole = columns.length === 1;

  async function remove() {
    const count = await countColumnCards(column.id);
    if (count > 0) return setDialog({ kind: 'delete', count });
    const note = edit.boards.length > 1 ? ` Колонка пропадёт у досок: ${quoted(edit.boards)}.` : '';
    if (confirm(`Удалить колонку «${column.name}»?${note}`)) await deleteColumn(column.id, null);
    return null;
  }

  const moves = [
    prevColumn && {
      label: `Все карточки в «${prevColumn.name}»`, icon: ICONS.allLeft, shortcut: 'Alt+ArrowLeft',
      disabled: !moveAll, run: () => moveAll(prevColumn),
    },
    nextColumn && {
      label: `Все карточки в «${nextColumn.name}»`, icon: ICONS.allRight, shortcut: 'Alt+ArrowRight',
      disabled: !moveAll, run: () => moveAll(nextColumn),
    },
    archiveAll !== undefined && { label: 'Архивировать все карточки', icon: ICONS.archive, disabled: !archiveAll, run: () => archiveAll() },
  ].filter(Boolean);
  const changes = edit ? [
    {
      label: 'Сдвинуть колонку левее', icon: ICONS.left, shortcut: 'Shift+ArrowLeft', disabled: index <= 0,
      run: () => moveColumn(column.id, -1),
    },
    {
      label: 'Сдвинуть колонку правее', icon: ICONS.right, shortcut: 'Shift+ArrowRight',
      disabled: index >= columns.length - 1, run: () => moveColumn(column.id, 1),
    },
    null,
    {
      label: 'Новые карточки — в начало', icon: ICONS.toTop, shortcut: 'KeyT', active: Boolean(column.addToTop),
      run: () => setColumnAddToTop(column.id, true),
    },
    {
      label: 'Новые карточки — в конец', icon: ICONS.toBottom, shortcut: 'KeyB', active: !column.addToTop,
      run: () => setColumnAddToTop(column.id, false),
    },
    { label: 'Цвет', icon: ICONS.palette, submenu: columnColorItems(column) },
    {
      label: column.wipLimit ? `WIP-лимит: ${column.wipLimit}` : 'WIP-лимит…', icon: ICONS.settings,
      run: () => setDialog({ kind: 'wip' }),
    },
    null,
    {
      label: 'Добавить колонку слева…', icon: ICONS.addLeft, shortcut: 'Shift+KeyN',
      run: () => setDialog({ kind: 'add', at: index }),
    },
    {
      label: 'Добавить колонку справа…', icon: ICONS.addRight, shortcut: 'KeyN',
      run: () => setDialog({ kind: 'add', at: index + 1 }),
    },
    null,
    { label: 'Набор колонок…', icon: ICONS.settings, shortcut: 'KeyS', run: edit.onSetSettings },
    null,
    { label: 'Удалить колонку', icon: ICONS.trash, shortcut: 'Delete', danger: true, disabled: sole, run: remove },
  ] : [];
  const collapse = onCollapse ? [collapsed
    ? { label: 'Развернуть колонку', icon: ICONS.expand, shortcut: 'KeyC', run: onCollapse }
    : { label: 'Свернуть колонку', icon: ICONS.collapse, shortcut: 'KeyC', run: onCollapse }] : [];
  const items = [collapse, moves, changes].filter((g) => g.length).flatMap((g, i) => (i ? [null, ...g] : g));
  useHoverShortcuts(hoverRef, items);

  const hasItems = items.length > 0;
  useEffect(() => {
    const el = hoverRef.current;
    if (!el || !hasItems) return undefined;
    const onContextMenu = (e) => {
      if (e.defaultPrevented || e.target.closest('a, input, textarea, .card')) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    el.addEventListener('contextmenu', onContextMenu);
    return () => el.removeEventListener('contextmenu', onContextMenu);
  }, [hoverRef, hasItems]);

  if (!hasItems) return null;

  return (
    <>
      {!collapsed && <button type="button" className={`btn btn-icon column-menu-btn ${menu ? 'active' : ''}`}
        title="Действия с колонкой (их клавиши работают и при наведении на колонку)" aria-label={`Действия с колонкой «${column.name}»`} {...menuButton}>
        <MoreIcon />
      </button>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
      {dialog?.kind === 'add' && (
        <NameDialog title="Новая колонка" value="" submitLabel="Добавить" edit={edit}
          onSave={(name) => insertColumn(edit.setId, name, dialog.at)} onClose={closeDialog} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteColumnDialog column={column} count={dialog.count} columns={columns} edit={edit} onClose={closeDialog} />
      )}
      {dialog?.kind === 'wip' && edit && (
        <WipLimitDialog column={column} edit={edit} onSave={(limit) => setColumnWipLimit(column.id, limit)}
          onClose={closeDialog} />
      )}
    </>
  );
}

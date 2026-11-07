import { useState } from 'react';
import { createPortal } from 'react-dom';
import { deleteFolder, folderStats, moveFolder, renameFolder, reorderFolder } from '../actions.js';
import { backgroundItems } from '../appearance.js';
import { isOwnBoard } from '../board.js';
import { childrenOf, descendants, folderColumnSetId, folderTree } from '../folders.js';
import { ICONS } from '../menuIcons.js';
import BoardSettings from './BoardSettings.jsx';
import ColumnsDraftDialog from './ColumnsDraftDialog.jsx';
import { NameField } from './EditableName.jsx';
import FolderSelect from './FolderSelect.jsx';
import Modal from './Modal.jsx';
import { FolderMembers, useCanShare } from './SharingSection.jsx';

const TOP = '';

/** Where a folder can go: the top level or under another folder (not itself or what is inside it). */
function MoveDialog({ folder, folders, model, writable, onClose }) {
  const tree = folderTree(folders);
  const inside = new Set([folder.id, ...descendants(folders, folder.id).map((f) => f.id)]);
  // Members move folders only where they have access.
  const exclude = new Set([...inside, ...folders.filter((f) => writable && !writable.has(f.id)).map((f) => f.id)]);
  const current = tree.parentOf(folder) ?? TOP;
  const [value, setValue] = useState(current);
  const [keepColumns, setKeepColumns] = useState(true);
  const [busy, setBusy] = useState(false);

  // A folder with a set of its own keeps it; one that takes it from its ancestors may get another set.
  const target = value || null;
  const moved = folders.map((f) => (f.id === folder.id ? { ...f, parentId: target } : f));
  const before = folderColumnSetId(folder, folders);
  const after = folderColumnSetId(moved.find((f) => f.id === folder.id), moved);
  const setName = (id) => model.sets.find((s) => s.id === id)?.name ?? '';
  const otherSet = !folder.columnSetId && before !== after;

  async function submit(e) {
    e.preventDefault();
    if (value === current || busy) return;
    setBusy(true);
    try {
      await moveFolder(folder.id, target, { keepColumns });
      onClose();
    } catch (err) {
      alert(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Перенести доску «${folder.name}»`} onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <FolderSelect label="Куда" folders={folders} exclude={exclude} value={value} onChange={setValue}
          topLabel={isOwnBoard ? 'Верхний уровень' : null} />
        <p className="move-result">Доска перейдёт со всеми вложенными досками и карточками.</p>
        {otherSet && (
          <div className="field">
            <span className="field-label">У новой доски другой набор колонок</span>
            <label className="radio-option">
              <input type="radio" name="keep-columns" checked={keepColumns} onChange={() => setKeepColumns(true)} />
              Оставить набор «{setName(before)}»
            </label>
            <label className="radio-option">
              <input type="radio" name="keep-columns" checked={!keepColumns} onChange={() => setKeepColumns(false)} />
              Взять набор «{setName(after)}»: карточки встанут в колонки с теми же названиями, остальные — в первую
            </label>
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={value === current || busy}>Перенести</button>
        </div>
      </form>
    </Modal>
  );
}

/** Deleting a folder that has something in it: delete it all, or keep the cards and the folders inside. */
function DeleteFolderDialog({ folder, stats, folders, onClose }) {
  const parentId = folders.find((f) => f.id === folder.parentId)?.id;
  const [targetId, setTargetId] = useState(parentId ?? folders.find((f) => f.id !== folder.id)?.id ?? '');
  const [error, setError] = useState(null);
  const total = stats.cards + stats.subCards;

  async function finish(keepCards) {
    try {
      await deleteFolder(folder.id, { keepCards, targetId });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Удалить доску" onClose={onClose}>
      <p>
        На доске «{folder.name}»: карточек {stats.cards}
        {stats.folders > 0 && `, вложенных досок ${stats.folders} (в них карточек ${stats.subCards})`}. Что с ними сделать?
      </p>
      {stats.cards > 0 && (
        <FolderSelect label="Карточки доски перенести на доску" folders={folders} exclude={new Set([folder.id])}
          value={targetId} onChange={setTargetId} />
      )}
      {error && <p className="login-error">{error}</p>}
      <div className="actions">
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn" disabled={stats.cards > 0 && !targetId} onClick={() => finish(true)}>
          Оставить карточки{stats.folders > 0 ? ' и вложенные доски' : ''}
        </button>
        <button className="btn btn-danger" onClick={() => finish(false)}>
          Удалить {total > 0 || stats.folders > 0 ? 'всё' : 'доску'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The menu items of a folder (board) and the dialogs they open: `items` and `removeItem` (meant to go last) go into
 * a ContextMenu, `dialogs` are rendered beside it and outlive the menu; without a folder there are none.
 * `onAccess` shows its members in place (otherwise in a dialog); `reorder` adds «Выше» / «Ниже».
 */
export function useFolderActions(folder, { folders, model, columnsSynced, writable, onAccess, accessActive, reorder = true }) {
  const [dialog, setDialog] = useState(null);
  const canShare = useCanShare();
  if (!folder) return { items: [], removeItem: null, dialogs: null };
  const siblings = childrenOf(folders, folderTree(folders).parentOf(folder));
  const index = siblings.findIndex((f) => f.id === folder.id);
  const close = () => setDialog(null);

  async function remove() {
    const stats = await folderStats(folder.id);
    if (stats.cards + stats.subCards + stats.folders > 0) setDialog({ name: 'delete', stats });
    else if (confirm(`Удалить доску «${folder.name}»?`)) await deleteFolder(folder.id);
  }

  const items = [
    canShare && {
      label: 'Доступ', icon: ICONS.access, shortcut: 'KeyA', active: accessActive,
      run: onAccess ?? (() => setDialog({ name: 'access' })),
    },
    { label: 'Перенести…', icon: ICONS.move, shortcut: 'KeyM', run: () => setDialog({ name: 'move' }) },
    isOwnBoard && columnsSynced && {
      label: 'Набор колонок…', icon: ICONS.settings, shortcut: 'KeyK', run: () => setDialog({ name: 'columns' }),
    },
    { label: 'Фон', icon: ICONS.palette, submenu: backgroundItems(folder) },
    { label: 'Настройки доски…', icon: ICONS.gear, run: () => setDialog({ name: 'settings' }) },
    reorder && null,
    reorder && {
      label: 'Выше', icon: ICONS.up, shortcut: 'Alt+ArrowUp', disabled: index <= 0,
      run: () => reorderFolder(folder.id, -1),
    },
    reorder && {
      label: 'Ниже', icon: ICONS.down, shortcut: 'Alt+ArrowDown', disabled: index < 0 || index >= siblings.length - 1,
      run: () => reorderFolder(folder.id, 1),
    },
  ].filter((item) => item !== false);
  const removeItem = { label: 'Удалить', icon: ICONS.trash, shortcut: 'Delete', danger: true, run: remove };

  const setId = model.setIdOf(folder);
  const dialogs = dialog && createPortal(
    dialog.name === 'move' ? <MoveDialog folder={folder} folders={folders} model={model} writable={writable} onClose={close} />
      : dialog.name === 'columns' ? (
        <ColumnsDraftDialog key={setId} model={model} setId={setId} folder={folder} folders={folders} onClose={close} />
      ) : dialog.name === 'settings' ? <BoardSettings folder={folder} folders={folders} onClose={close} />
        : dialog.name === 'delete' ? <DeleteFolderDialog folder={folder} stats={dialog.stats} folders={folders} onClose={close} />
          : (
            <Modal title={`Доступ к доске «${folder.name}»`} onClose={close}>
              <div className="manage"><FolderMembers folder={folder} folders={folders} /></div>
              <div className="actions">
                <button className="btn btn-primary" onClick={close}>Готово</button>
              </div>
            </Modal>
          ),
    document.body,
  );
  return { items, removeItem, dialogs };
}

/**
 * A board's name in the board title, renamed in place like EditableName, but `renaming` is the caller's (the board's
 * menu renames it too): a click (Enter / F2) calls `onRename`, `onRenamed` when the field is done.
 */
export function BoardName({ folder, renaming, onRename, onRenamed }) {
  if (renaming) {
    return (
      <NameField value={folder.name} label="Название доски" maxLength={200} className="" note={null}
        onSave={(name) => renameFolder(folder.id, name)} onDone={onRenamed} />
    );
  }
  return (
    <span role="button" tabIndex={0} className="editable-name" title="Нажмите, чтобы переименовать"
      aria-label={`${folder.name} — переименовать`}
      onClick={(e) => {
        e.stopPropagation();
        onRename();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'F2') return;
        e.preventDefault();
        onRename();
      }}>
      {folder.name}
    </span>
  );
}

/** The board's «⋯» beside its title: `open` (the menu is open) toggles it, `onMenu` gets where the menu goes or null. */
export function BoardMenuButton({ open, onMenu }) {
  return (
    <button type="button" className={`btn btn-icon board-menu-btn ${open ? 'active' : ''}`}
      title="Действия с доской" aria-label="Действия с доской" aria-haspopup="menu" aria-expanded={open}
      onMouseDown={(e) => open && e.stopPropagation()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onMenu(open ? null : { x: r.left, y: r.bottom + 4 });
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>
  );
}


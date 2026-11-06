import { useCallback, useRef, useState } from 'react';
import { createFolder, moveFolder, renameFolder, reorderFolder } from '../actions.js';
import { isOwnBoard } from '../board.js';
import { childrenOf, descendants, flattenFolders, folderColumnSetId, folderPath, folderTree } from '../folders.js';
import { ICONS } from '../menuIcons.js';
import ContextMenu from './ContextMenu.jsx';
import FolderSelect from './FolderSelect.jsx';
import { AddButton, Chevron, plural, useOutsidePress } from './ManageFields.jsx';
import Modal from './Modal.jsx';
import { FolderMembers, useCanShare } from './SharingSection.jsx';

const SEARCH_FROM = 7;
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

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/** The folder's name edited in place: Enter, leaving the field or a press outside saves, Escape cancels. */
function InlineName({ value, onSave, onDone }) {
  const [draft, setDraft] = useState(value);
  const input = useRef(null);
  const done = useRef(false);
  const finish = (save) => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    if (save && name && name !== value) onSave(name);
    onDone();
  };
  useOutsidePress(input, () => finish(true));
  return (
    <input ref={input} className="manage-input tree-rename" value={draft} maxLength={200} aria-label="Название доски"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(false);
        }
      }} />
  );
}

/** One folder: a row with its name and actions; clicking it opens the folder (its contents are listed instead). */
function FolderRow({ folder, index, count, ctx }) {
  const { model, folders, columnsSynced, canShare, needle, onOpen } = ctx;
  const tree = folderTree(folders);
  const kids = childrenOf(folders, folder.id);
  const [panel, setPanel] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const isRoot = !tree.parentOf(folder);
  const own = Boolean(folder.columnSetId);
  const setName = model.sets.find((s) => s.id === model.setIdOf(folder))?.name;
  // While searching, where the folder is matters more than what is inside it.
  const where = needle && folderPath(folder, folders).slice(0, -1).map((f) => f.name).join(' › ');
  const meta = [
    where,
    !needle && (kids.length ? `${kids.length} ${plural(kids.length, 'доска', 'доски', 'досок')}` : null),
    columnsSynced && setName && `«${setName}»${own || isRoot ? '' : ' (как у родителя)'}`,
  ].filter(Boolean).join(' · ');
  const togglePanel = (name) => setPanel(panel === name ? null : name);
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItems = [
    { label: 'Открыть', icon: ICONS.open, shortcut: 'KeyO', run: () => onOpen(folder.id) },
    { label: 'Переименовать', icon: ICONS.rename, shortcut: 'F2', run: () => setRenaming(true) },
    canShare && {
      label: 'Доступ', icon: ICONS.access, shortcut: 'KeyA', active: panel === 'access', run: () => togglePanel('access'),
    },
    { label: 'Перенести…', icon: ICONS.move, shortcut: 'KeyM', run: () => ctx.onMove(folder) },
    !needle && null,
    !needle && {
      label: 'Выше', icon: ICONS.up, shortcut: 'Alt+ArrowUp', disabled: index === 0,
      run: () => reorderFolder(folder.id, -1),
    },
    !needle && {
      label: 'Ниже', icon: ICONS.down, shortcut: 'Alt+ArrowDown', disabled: index >= count - 1,
      run: () => reorderFolder(folder.id, 1),
    },
    null,
    { label: 'Удалить', icon: ICONS.trash, shortcut: 'Delete', danger: true, run: () => ctx.onRemove(folder) },
  ].filter((item) => item !== false);

  return (
    <section className={`tree-node tree-folder ${panel ? 'tree-node-open' : ''}`}>
      <div className="tree-head" onContextMenu={(e) => {
        if (renaming) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}>
        {renaming ? (
          <InlineName value={folder.name} onSave={(name) => renameFolder(folder.id, name)} onDone={() => setRenaming(false)} />
        ) : (
          <button type="button" className="tree-toggle" title="Открыть доску" onClick={() => onOpen(folder.id)}>
            <FolderIcon />
            <span className="tree-title">
              <span className="tree-label">{folder.name}</span>
              {meta && <span className="tree-meta">{meta}</span>}
            </span>
            <Chevron />
          </button>
        )}
        <button type="button" className={`btn btn-small btn-icon-only tree-more ${menu ? 'active' : ''}`}
          title="Действия" aria-label="Действия с доской" aria-haspopup="menu" aria-expanded={Boolean(menu)}
          onMouseDown={(e) => menu && e.stopPropagation()}
          onClick={(e) => {
            if (menu) return setMenu(null);
            const r = e.currentTarget.getBoundingClientRect();
            return setMenu({ x: r.right - 260, y: r.bottom + 4 });
          }}>
          <MoreIcon />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
      {panel === 'access' && canShare && (
        <div className="tree-body"><FolderMembers folder={folder} folders={folders} /></div>
      )}
    </section>
  );
}

function FolderIcon() {
  return (
    <svg className="tree-folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

/**
 * The folders of the board, one level at a time: breadcrumbs lead back up, a folder opens on click.
 * Names, order and access; a folder moves to another place with everything in it.
 * `writable` (a set of ids, or null for all) are the folders a member may touch.
 */
export default function StructureEditor({
  model, folders, synced, columnsSynced, writable, onRemoveFolder,
}) {
  const canShare = useCanShare();
  const tree = folderTree(folders);
  const [currentId, setCurrentId] = useState(null);
  // The opened folder may be deleted or moved away meanwhile: then its nearest live ancestor, or the top.
  const current = currentId ? tree.byId.get(currentId) ?? null : null;
  const path = current ? folderPath(current, folders) : [];
  const list = childrenOf(folders, current?.id ?? null);
  const [moving, setMoving] = useState(null);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const found = needle ? flattenFolders(folders).map(({ folder }) => folder).filter((f) => f.name.toLowerCase().includes(needle)) : [];

  if (!synced) return <p className="muted">Доски появятся после синхронизации.</p>;

  const open = (id) => {
    setQuery('');
    setCurrentId(id);
  };
  const ctx = {
    model, folders, columnsSynced, canShare, needle, onOpen: open,
    onMove: setMoving, onRemove: onRemoveFolder,
  };
  const canAddHere = current ? true : isOwnBoard;
  return (
    <div className="manage tree">
      {!isOwnBoard && <p className="muted">Колонки настраивает владелец пространства, здесь можно менять доски внутри открытых вам.</p>}
      {folders.length >= SEARCH_FROM && (
        <label className="field">
          <span className="field-label">Поиск доски</span>
          <input type="search" className="manage-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {!needle && (
        <nav className="breadcrumbs" aria-label="Путь">
          <button type="button" className="crumb" disabled={!current} onClick={() => open(null)}>Все доски</button>
          {path.map((f, i) => (
            <span key={f.id} className="crumb-item">
              <span className="crumb-sep" aria-hidden="true">›</span>
              <button type="button" className="crumb" disabled={i === path.length - 1} onClick={() => open(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      {needle ? (
        found.length
          ? found.map((f) => <FolderRow key={f.id} folder={f} index={0} count={1} ctx={ctx} />)
          : <p className="muted">Ничего не найдено.</p>
      ) : (
        <>
          {list.map((f, i) => <FolderRow key={f.id} folder={f} index={i} count={list.length} ctx={ctx} />)}
          {list.length === 0 && <p className="muted">У этой доски нет вложенных досок.</p>}
          {canAddHere && (
            <AddButton key={current?.id ?? 'top'} label={current ? `Новая доска в «${current.name}»` : 'Новая доска верхнего уровня'}
              onAdd={async (name) => {
                await createFolder(name, current ? { parentId: current.id } : { columnSetId: model.newFolderSetId });
              }} />
          )}
        </>
      )}

      {moving && (
        <MoveDialog folder={moving} folders={folders} model={model} writable={writable} onClose={() => setMoving(null)} />
      )}
    </div>
  );
}

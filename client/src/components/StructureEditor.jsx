import { useCallback, useState } from 'react';
import { createFolder, moveFolder, renameFolder, reorderFolder } from '../actions.js';
import { isOwnBoard } from '../board.js';
import { childrenOf, descendants, folderColumnSetId, folderTree } from '../folders.js';
import ContextMenu from './ContextMenu.jsx';
import FolderSelect from './FolderSelect.jsx';
import { AddButton, Chevron, plural } from './ManageFields.jsx';
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
    <Modal title={`Перенести папку «${folder.name}»`} onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <FolderSelect label="Куда" folders={folders} exclude={exclude} value={value} onChange={setValue}>
          {isOwnBoard && <option value={TOP}>Верхний уровень</option>}
        </FolderSelect>
        <p className="move-result">Папка перейдёт со всеми вложенными папками и карточками.</p>
        {otherSet && (
          <div className="field">
            <span className="field-label">У новой папки другой набор колонок</span>
            <label className="member-project">
              <input type="radio" name="keep-columns" checked={keepColumns} onChange={() => setKeepColumns(true)} />
              Оставить набор «{setName(before)}»
            </label>
            <label className="member-project">
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

/** The folder's name edited in place: Enter or leaving the field saves, Escape cancels. */
function InlineName({ value, onSave, onDone }) {
  const [draft, setDraft] = useState(value);
  const finish = (save) => {
    const name = draft.trim();
    if (save && name && name !== value) onSave(name);
    onDone();
  };
  return (
    <input className="manage-input tree-rename" value={draft} maxLength={200} autoFocus aria-label="Название папки"
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

/** One folder: a row with its name and actions; when expanded, the folders inside it. */
function FolderNode({ folder, index, count, ctx }) {
  const { model, folders, columnsSynced, canShare, needle, matches, isOpen, toggle, expand } = ctx;
  const tree = folderTree(folders);
  const kids = childrenOf(folders, folder.id);
  const shownKids = kids.filter(matches);
  const open = Boolean(needle) || isOpen(folder.id);
  const [panel, setPanel] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const isRoot = !tree.parentOf(folder);
  const parent = tree.byId.get(tree.parentOf(folder));
  const own = Boolean(folder.columnSetId);
  const setId = folderColumnSetId(folder, folders);
  const setName = model.sets.find((s) => s.id === model.setIdOf(folder))?.name;
  const parentSetName = parent && model.sets.find((s) => s.id === model.setIdOf(parent))?.name;
  const meta = [
    kids.length ? `${kids.length} ${plural(kids.length, 'вложенная папка', 'вложенные папки', 'вложенных папок')}` : null,
    columnsSynced && setName && `«${setName}»${own || isRoot ? '' : ' (как у родителя)'}`,
  ].filter(Boolean).join(' · ');
  const togglePanel = (name) => setPanel(panel === name ? null : name);
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItems = [
    { label: 'Переименовать', run: () => setRenaming(true) },
    canShare && { label: 'Доступ', active: panel === 'access', run: () => togglePanel('access') },
    columnsSynced && isOwnBoard && { label: 'Набор колонок', active: panel === 'columns', run: () => togglePanel('columns') },
    { label: 'Новая вложенная папка', run: () => { expand(folder.id); setAdding(true); } },
    { label: 'Перенести…', run: () => ctx.onMove(folder) },
    !needle && null,
    !needle && { label: 'Выше', disabled: index === 0, run: () => reorderFolder(folder.id, -1) },
    !needle && { label: 'Ниже', disabled: index >= count - 1, run: () => reorderFolder(folder.id, 1) },
    null,
    { label: 'Удалить', danger: true, run: () => ctx.onRemove(folder) },
  ].filter((item) => item !== false);

  return (
    <section className={`tree-node tree-folder ${panel ? 'tree-node-open' : ''}`}>
      <div className="tree-head" onContextMenu={(e) => {
        if (renaming) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}>
        <button type="button" className="tree-chevron"
          aria-expanded={open} aria-label={open ? 'Свернуть' : 'Развернуть'} onClick={() => toggle(folder.id)}>
          <Chevron />
        </button>
        {renaming ? (
          <InlineName value={folder.name} onSave={(name) => renameFolder(folder.id, name)} onDone={() => setRenaming(false)} />
        ) : (
          <button type="button" className="tree-toggle" onClick={() => toggle(folder.id)} onDoubleClick={() => setRenaming(true)}>
            <span className="tree-title">
              <span className="tree-label">{folder.name}</span>
              {meta && <span className="tree-meta">{meta}</span>}
            </span>
          </button>
        )}
        <button type="button" className={`btn btn-small btn-icon-only tree-more ${menu ? 'active' : ''}`}
          title="Действия" aria-label="Действия с папкой" aria-haspopup="menu" aria-expanded={Boolean(menu)}
          onMouseDown={(e) => menu && e.stopPropagation()}
          onClick={(e) => {
            if (menu) return setMenu(null);
            const r = e.currentTarget.getBoundingClientRect();
            return setMenu({ x: r.right - 200, y: r.bottom + 4 });
          }}>
          <MoreIcon />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
      {panel === 'access' && canShare && (
        <div className="tree-body"><FolderMembers folder={folder} folders={folders} /></div>
      )}
      {panel === 'columns' && columnsSynced && isOwnBoard && (
        <div className="tree-body">
          <label className="field">
            <span className="field-label">Набор колонок</span>
            <select className="select" value={own || isRoot ? setId : TOP}
              onChange={(e) => ctx.onChangeSet(folder, e.target.value || null)}>
              {!isRoot && <option value={TOP}>Как у родителя{parentSetName ? ` («${parentSetName}»)` : ''}</option>}
              {model.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <p className="muted account-hint">
            Колонки набора общие для папки и вложенных в неё папок, у которых нет своего набора.
          </p>
        </div>
      )}
      {open && (
        <div className="tree-children">
          {shownKids.map((child) => (
            <FolderNode key={child.id} folder={child} index={kids.indexOf(child)} count={kids.length} ctx={ctx} />
          ))}
          {!needle && (
            <AddButton label="Новая вложенная папка" open={adding} onOpenChange={setAdding} onAdd={async (name) => {
              await createFolder(name, { parentId: folder.id });
            }} />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The folders of the board in one tree of any depth: names, order, access and column sets; a folder moves
 * to another place with everything in it. `writable` (a set of ids, or null for all) are the folders a
 * member may touch.
 */
export default function StructureEditor({
  model, folders, synced, columnsSynced, writable, onChangeSet, onRemoveFolder,
}) {
  const canShare = useCanShare();
  const roots = childrenOf(folders, null);
  // Expanded folders show their settings and the folders inside them; collapsed ones hide the whole branch.
  const [openIds, setOpenIds] = useState(() => new Set(folders.length === 1 ? [folders[0].id] : []));
  const isOpen = (id) => openIds.has(id);
  const toggle = (id) => setOpenIds((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const expand = (id) => setOpenIds((s) => new Set([...s, id]));
  const [moving, setMoving] = useState(null);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matchesSelf = (f) => f.name.toLowerCase().includes(needle);
  const matches = (f) => !needle || matchesSelf(f) || descendants(folders, f.id).some(matchesSelf);

  if (!synced) return <p className="muted">Папки появятся после синхронизации.</p>;

  const ctx = {
    model, folders, columnsSynced, canShare, needle, matches, isOpen, toggle, expand,
    onMove: setMoving, onChangeSet, onRemove: onRemoveFolder,
  };
  return (
    <div className="manage tree">
      {!isOwnBoard && <p className="muted">Колонки настраивает владелец доски, здесь можно менять папки внутри открытых вам.</p>}
      {folders.length >= SEARCH_FROM && (
        <label className="field">
          <span className="field-label">Поиск папки</span>
          <input type="search" className="manage-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {!needle && folders.length > 1 && (
        <div className="tree-expand-all">
          <button type="button" className="btn btn-small" onClick={() => setOpenIds(new Set(folders.map((f) => f.id)))}>
            Развернуть все
          </button>
          <button type="button" className="btn btn-small" disabled={!openIds.size} onClick={() => setOpenIds(new Set())}>
            Свернуть все
          </button>
        </div>
      )}
      {roots.filter(matches).map((root) => (
        <FolderNode key={root.id} folder={root} index={roots.indexOf(root)} count={roots.length} ctx={ctx} />
      ))}
      {needle && !roots.some(matches) && <p className="muted">Ничего не найдено.</p>}
      {!needle && isOwnBoard && (
        <AddButton label="Новая папка верхнего уровня" onAdd={async (name) => {
          const id = await createFolder(name, { columnSetId: model.newFolderSetId });
          expand(id);
        }} />
      )}

      {moving && (
        <MoveDialog folder={moving} folders={folders} model={model} writable={writable} onClose={() => setMoving(null)} />
      )}
    </div>
  );
}

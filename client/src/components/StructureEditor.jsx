import { useState } from 'react';
import { createFolder, moveFolder, renameFolder, reorderFolder } from '../actions.js';
import { isOwnBoard } from '../board.js';
import { childrenOf, descendants, folderColumnSetId, folderTree } from '../folders.js';
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

const icon = (d) => function Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((path) => <path key={path} d={path} />)}
    </svg>
  );
};
const EditIcon = icon(['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z']);
const PeopleIcon = icon(['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75']);
const ColumnsIcon = icon(['M3 4h18v16H3Z', 'M9 4v16', 'M15 4v16']);
const MoveIcon = icon(['M5 9l-3 3 3 3', 'M9 5l3-3 3 3', 'M15 19l-3 3-3-3', 'M19 9l3 3-3 3', 'M2 12h20', 'M12 2v20']);
const TrashIcon = icon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6']);
const UpIcon = icon(['M12 19V5', 'm5 12 7-7 7 7']);
const DownIcon = icon(['M12 5v14', 'm19 12-7 7-7-7']);

function IconButton({ label, onClick, active = false, danger = false, disabled = false, children }) {
  return (
    <button type="button" className={`btn btn-small btn-icon-only tree-action ${active ? 'btn-primary' : ''} ${danger ? 'btn-danger' : ''}`}
      title={label} aria-label={label} aria-pressed={active || undefined} disabled={disabled} onClick={onClick}>
      {children}
    </button>
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
  const { model, folders, columnsSynced, canShare, needle, matches, isOpen, toggle } = ctx;
  const tree = folderTree(folders);
  const kids = childrenOf(folders, folder.id);
  const shownKids = kids.filter(matches);
  const open = Boolean(needle) || isOpen(folder.id);
  const [panel, setPanel] = useState(null);
  const [renaming, setRenaming] = useState(false);
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

  return (
    <section className={`tree-node tree-folder ${panel ? 'tree-node-open' : ''}`}>
      <div className="tree-head">
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
        <div className="tree-actions">
          <IconButton label="Переименовать" active={renaming} onClick={() => setRenaming(!renaming)}><EditIcon /></IconButton>
          {canShare && (
            <IconButton label="Доступ" active={panel === 'access'} onClick={() => togglePanel('access')}><PeopleIcon /></IconButton>
          )}
          {columnsSynced && isOwnBoard && (
            <IconButton label="Набор колонок" active={panel === 'columns'} onClick={() => togglePanel('columns')}><ColumnsIcon /></IconButton>
          )}
          <IconButton label="Перенести…" onClick={() => ctx.onMove(folder)}><MoveIcon /></IconButton>
          {!needle && (
            <>
              <IconButton label="Выше" disabled={index === 0} onClick={() => reorderFolder(folder.id, -1)}><UpIcon /></IconButton>
              <IconButton label="Ниже" disabled={index >= count - 1} onClick={() => reorderFolder(folder.id, 1)}><DownIcon /></IconButton>
            </>
          )}
          <IconButton label="Удалить" danger onClick={() => ctx.onRemove(folder)}><TrashIcon /></IconButton>
        </div>
      </div>
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
            <AddButton label="Новая вложенная папка" onAdd={async (name) => {
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

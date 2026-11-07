import { useRef, useState } from 'react';
import { createFolder, renameFolder } from '../actions.js';
import { isOwnBoard } from '../board.js';
import { childrenOf, flattenFolders, folderPath, folderTree } from '../folders.js';
import { ICONS } from '../menuIcons.js';
import ContextMenu, { useHoverShortcuts, useMenuButton } from './ContextMenu.jsx';
import EditableName from './EditableName.jsx';
import { useFolderActions } from './FolderMenu.jsx';
import { AddButton, Chevron, plural } from './ManageFields.jsx';
import { FolderMembers, useCanShare } from './SharingSection.jsx';

const SEARCH_FROM = 7;

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/** One folder: a row with its name and actions; clicking it opens the folder (its contents are listed instead). */
function FolderRow({ folder, ctx }) {
  const { model, folders, columnsSynced, canShare, needle, onOpen } = ctx;
  const tree = folderTree(folders);
  const kids = childrenOf(folders, folder.id);
  const [panel, setPanel] = useState(null);
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
  const [menu, setMenu, closeMenu, menuButton] = useMenuButton(260);
  const actions = useFolderActions(folder, {
    folders, model, columnsSynced, writable: ctx.writable, reorder: !needle,
    onAccess: () => togglePanel('access'), accessActive: panel === 'access',
  });
  const menuItems = [
    { label: 'Открыть', icon: ICONS.open, shortcut: 'KeyO', run: () => onOpen(folder.id) },
    ...actions.items,
    null,
    actions.removeItem,
  ];
  const node = useRef(null);
  useHoverShortcuts(node, menuItems);

  return (
    <section ref={node} className={`tree-node tree-folder ${panel ? 'tree-node-open' : ''}`}>
      <div className="tree-head" onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}>
        <button type="button" className="tree-toggle" title="Открыть доску" onClick={() => onOpen(folder.id)}>
          <FolderIcon />
          <span className="tree-title">
            <span className="tree-label">{folder.name}</span>
            {meta && <span className="tree-meta">{meta}</span>}
          </span>
          <Chevron />
        </button>
        <button type="button" className={`btn btn-small btn-icon-only tree-more ${menu ? 'active' : ''}`}
          title="Действия (их клавиши работают и при наведении на доску)" aria-label="Действия с доской" {...menuButton}>
          <MoreIcon />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
      {actions.dialogs}
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
  model, folders, synced, columnsSynced, writable,
}) {
  const canShare = useCanShare();
  const tree = folderTree(folders);
  const [currentId, setCurrentId] = useState(null);
  // The opened folder may be deleted or moved away meanwhile: then its nearest live ancestor, or the top.
  const current = currentId ? tree.byId.get(currentId) ?? null : null;
  const path = current ? folderPath(current, folders) : [];
  const list = childrenOf(folders, current?.id ?? null);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const found = needle ? flattenFolders(folders).map(({ folder }) => folder).filter((f) => f.name.toLowerCase().includes(needle)) : [];

  if (!synced) return <p className="muted">Доски появятся после синхронизации.</p>;

  const open = (id) => {
    setQuery('');
    setCurrentId(id);
  };
  const ctx = { model, folders, columnsSynced, writable, canShare, needle, onOpen: open };
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
              {i === path.length - 1 && (!writable || writable.has(f.id)) ? (
                <EditableName value={f.name} label="Название доски" className="crumb crumb-current"
                  onSave={(name) => renameFolder(f.id, name)} />
              ) : (
                <button type="button" className="crumb" disabled={i === path.length - 1} onClick={() => open(f.id)}>
                  {f.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}
      {needle ? (
        found.length
          ? found.map((f) => <FolderRow key={f.id} folder={f} ctx={ctx} />)
          : <p className="muted">Ничего не найдено.</p>
      ) : (
        <>
          {list.map((f) => <FolderRow key={f.id} folder={f} ctx={ctx} />)}
          {list.length === 0 && <p className="muted">У этой доски нет вложенных досок.</p>}
          {canAddHere && (
            <AddButton key={current?.id ?? 'top'} label={current ? `Новая доска в «${current.name}»` : 'Новая доска верхнего уровня'}
              onAdd={async (name) => {
                await createFolder(name, current ? { parentId: current.id } : { columnSetId: model.newFolderSetId });
              }} />
          )}
        </>
      )}

    </div>
  );
}

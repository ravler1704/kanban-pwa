import { useState } from 'react';
import { createFolder, moveFolder, renameFolder, reorderFolder } from '../actions.js';
import { isOwnBoard } from '../board.js';
import { childrenOf, descendants, folderColumnSetId, folderTree } from '../folders.js';
import FolderSelect from './FolderSelect.jsx';
import { AddButton, Chevron, NameInput, plural } from './ManageFields.jsx';
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

function OrderButtons({ onMove, canUp, canDown }) {
  return (
    <>
      <button className="btn btn-small" title="Выше" aria-label="Выше" disabled={!canUp} onClick={() => onMove(-1)}>↑</button>
      <button className="btn btn-small" title="Ниже" aria-label="Ниже" disabled={!canDown} onClick={() => onMove(1)}>↓</button>
    </>
  );
}

/** One folder with its settings (when open) and, below, the folders inside it. */
function FolderNode({ folder, index, count, ctx }) {
  const { model, folders, columnsSynced, canShare, needle, matches, openId, setOpenId, sharingId, setSharingId } = ctx;
  const tree = folderTree(folders);
  const kids = childrenOf(folders, folder.id);
  const shownKids = kids.filter(matches);
  const open = openId === folder.id;
  const isRoot = !tree.parentOf(folder);
  const parent = tree.byId.get(tree.parentOf(folder));
  const own = Boolean(folder.columnSetId);
  const setId = folderColumnSetId(folder, folders);
  const setName = model.sets.find((s) => s.id === model.setIdOf(folder))?.name;
  const parentSetName = parent && model.sets.find((s) => s.id === model.setIdOf(parent))?.name;
  const meta = [
    kids.length ? `${kids.length} ${plural(kids.length, 'вложенная папка', 'вложенные папки', 'вложенных папок')}` : 'без вложенных',
    columnsSynced && setName && `набор «${setName}»${own || isRoot ? '' : ' (как у родителя)'}`,
  ].filter(Boolean).join(' · ');

  return (
    <section className={`tree-node tree-folder ${open ? 'tree-node-open' : ''}`}>
      <div className="tree-head">
        <button type="button" className="tree-toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : folder.id)}>
          <Chevron />
          <span className="tree-title">
            <span className="tree-label">{folder.name}</span>
            <span className="tree-meta">{meta}</span>
          </span>
        </button>
        {!needle && (
          <OrderButtons canUp={index > 0} canDown={index < count - 1} onMove={(d) => reorderFolder(folder.id, d)} />
        )}
      </div>
      {open && (
        <div className="tree-body">
          <div className="manage-row">
            <NameInput value={folder.name} className="manage-project-name" label="Название папки"
              onSave={(name) => renameFolder(folder.id, name)} />
            {canShare && (
              <button className={`btn btn-small ${sharingId === folder.id ? 'btn-primary' : ''}`}
                aria-expanded={sharingId === folder.id}
                onClick={() => setSharingId(sharingId === folder.id ? null : folder.id)}>Доступ</button>
            )}
            <button className="btn btn-small" onClick={() => ctx.onMove(folder)}>Перенести…</button>
            <button className="btn btn-small btn-danger" onClick={() => ctx.onRemove(folder)}>Удалить</button>
          </div>
          {canShare && sharingId === folder.id && <FolderMembers folder={folder} folders={folders} />}
          {columnsSynced && isOwnBoard && (
            <label className="field">
              <span className="field-label">Набор колонок</span>
              <select className="select" value={own || isRoot ? setId : TOP}
                onChange={(e) => ctx.onChangeSet(folder, e.target.value || null)}>
                {!isRoot && <option value={TOP}>Как у родителя{parentSetName ? ` («${parentSetName}»)` : ''}</option>}
                {model.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <p className="muted account-hint">
            Колонки набора общие для папки и вложенных в неё папок, у которых нет своего набора.
          </p>
        </div>
      )}
      <div className="tree-children">
        {shownKids.map((child) => (
          <FolderNode key={child.id} folder={child} index={kids.indexOf(child)} count={kids.length} ctx={ctx} />
        ))}
        {!needle && (
          <AddButton label="Новая вложенная папка" onAdd={async (name) => {
            const id = await createFolder(name, { parentId: folder.id });
            setOpenId(id);
          }} />
        )}
      </div>
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
  const [openId, setOpenId] = useState(() => (folders.length === 1 ? folders[0].id : null));
  const [sharingId, setSharingId] = useState(null);
  const [moving, setMoving] = useState(null);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matchesSelf = (f) => f.name.toLowerCase().includes(needle);
  const matches = (f) => !needle || matchesSelf(f) || descendants(folders, f.id).some(matchesSelf);

  if (!synced) return <p className="muted">Папки появятся после синхронизации.</p>;

  const ctx = {
    model, folders, columnsSynced, canShare, needle, matches, openId, setOpenId, sharingId, setSharingId,
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
      {roots.filter(matches).map((root) => (
        <FolderNode key={root.id} folder={root} index={roots.indexOf(root)} count={roots.length} ctx={ctx} />
      ))}
      {needle && !roots.some(matches) && <p className="muted">Ничего не найдено.</p>}
      {!needle && isOwnBoard && (
        <AddButton label="Новая папка верхнего уровня" onAdd={async (name) => {
          const id = await createFolder(name, { columnSetId: model.newFolderSetId });
          setOpenId(id);
        }} />
      )}

      {moving && (
        <MoveDialog folder={moving} folders={folders} model={model} writable={writable} onClose={() => setMoving(null)} />
      )}
    </div>
  );
}

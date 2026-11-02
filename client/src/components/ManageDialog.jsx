import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  changeFolderColumnSet, countColumnCards, countInheritingCards, createColumn, createColumnSet, deleteColumn,
  deleteColumnSet, deleteFolder, folderStats, moveColumn, renameColumn, renameColumnSet, setColumnAddToTop,
} from '../actions.js';
import { isOwnBoard } from '../board.js';
import { matchColumn } from '../columnSets.js';
import { db } from '../db.js';
import { folderColumnSetId, inheritingFolders } from '../folders.js';
import FolderSelect from './FolderSelect.jsx';
import { AddForm, NameInput } from './ManageFields.jsx';
import Modal from './Modal.jsx';
import PublicLinkSettings from './PublicLinkSettings.jsx';
import { FolderMembers, useCanShare } from './SharingSection.jsx';
import StructureEditor from './StructureEditor.jsx';

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
        <label className="field">
          <span className="field-label">Перенести карточки в</span>
          <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-danger">Перенести и удалить</button>
        </div>
      </form>
    </Modal>
  );
}

const folderList = (folders) => folders.map((f) => `«${f.name}»`).join(', ');

/** Which folders a change of the set affects; shown above its columns so it is never a surprise. */
function SetUsage({ folders }) {
  if (folders.length === 0) {
    return <p className="set-usage set-usage-unused">Этот набор пока не использует ни одна папка.</p>;
  }
  return (
    <p className="set-usage">
      {folders.length === 1
        ? <>Набор использует папка {folderList(folders)}. Изменения колонок сразу применятся к ней.</>
        : <>Набор используют папки: {folderList(folders)}. Изменения колонок сразу применятся ко всем этим папкам.</>}
    </p>
  );
}

function ColumnSetsEditor({ model, synced, initialSetId }) {
  const [picked, setPicked] = useState(initialSetId);
  const set = model.sets.find((s) => s.id === picked) ?? model.sets[0];
  const users = model.foldersOf(set.id);

  if (!synced) {
    return <p className="muted">Колонки можно будет изменить после первой синхронизации с сервером.</p>;
  }

  async function addSet() {
    const name = prompt('Название нового набора колонок (колонки скопируются из текущего):', `${set.name} — копия`);
    if (!name?.trim()) return;
    setPicked(await createColumnSet(name.trim().slice(0, 100), set.id));
  }

  async function removeSet() {
    if (!confirm(`Удалить набор «${set.name}» вместе с его колонками?`)) return;
    await deleteColumnSet(set.id);
    setPicked(null);
  }

  return (
    <div className="manage">
      <div className="manage-row">
        <label className="field set-picker">
          <span className="field-label">Набор колонок</span>
          <select className="select" value={set.id} onChange={(e) => setPicked(e.target.value)}>
            {model.sets.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({model.foldersOf(s.id).length})</option>
            ))}
          </select>
        </label>
        <button className="btn btn-small" onClick={addSet}>Новый набор</button>
      </div>
      <div className="manage-row">
        <NameInput key={set.id} value={set.name} className="manage-project-name" label="Название набора"
          maxLength={100} onSave={(name) => renameColumnSet(set.id, name)} />
        <button className="btn btn-small btn-danger" disabled={users.length > 0 || model.sets.length === 1}
          title={users.length > 0 ? 'Сначала переключите папки на другой набор' : undefined}
          onClick={removeSet}>Удалить набор</button>
      </div>
      <SetUsage folders={users} />
      <ColumnsEditor setId={set.id} columns={model.columnsOf(set.id)} />
    </div>
  );
}

function ColumnsEditor({ setId, columns }) {
  const [deleting, setDeleting] = useState(null);

  async function remove(column) {
    const count = await countColumnCards(column.id);
    if (count > 0) setDeleting({ column, count });
    else if (confirm(`Удалить колонку «${column.name}»?`)) await deleteColumn(column.id, null);
  }

  return (
    <div className="manage-columns">
      <p className="manage-hint muted">
        Новые и перенесённые в колонку карточки ставятся в её начало или в конец.
        Перетаскиванием карточку можно поставить в любое место.
      </p>
      {columns.map((c, i) => (
        <div key={c.id} className="manage-row">
          <NameInput value={c.name} label="Название колонки" maxLength={100}
            onSave={(name) => renameColumn(c.id, name)} />
          <label className="field manage-place">
            <span className="field-label">Новые карточки</span>
            <select className="select" value={c.addToTop ? 'top' : 'bottom'}
              title="Куда ставить новые и перенесённые карточки"
              onChange={(e) => setColumnAddToTop(c.id, e.target.value === 'top')}>
              <option value="bottom">В конец</option>
              <option value="top">В начало</option>
            </select>
          </label>
          <button className="btn btn-small" title="Выше" aria-label="Выше" disabled={i === 0}
            onClick={() => moveColumn(c.id, -1)}>↑</button>
          <button className="btn btn-small" title="Ниже" aria-label="Ниже" disabled={i === columns.length - 1}
            onClick={() => moveColumn(c.id, 1)}>↓</button>
          <button className="btn btn-small btn-danger" disabled={columns.length === 1}
            title={columns.length === 1 ? 'Нужна хотя бы одна колонка' : undefined}
            onClick={() => remove(c)}>Удалить</button>
        </div>
      ))}
      <AddForm label="Новая колонка" onAdd={(name) => createColumn(setId, name)} />
      {deleting && (
        <DeleteColumnDialog column={deleting.column} count={deleting.count} columns={columns}
          onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

/**
 * Switching a folder to another column set (`setId`, null: the ancestor's): where the cards of each
 * current column go, also those of the subfolders that take their set from this folder.
 */
function ChangeSetDialog({ model, folder, folders, setId, onClose }) {
  const group = inheritingFolders(folder, folders);
  const nextId = folderColumnSetId({ ...folder, columnSetId: setId }, folders);
  const from = model.columnsOf(folderColumnSetId(folder, folders));
  const to = model.columnsOf(nextId);
  const set = model.sets.find((s) => s.id === nextId);
  const counts = useLiveQuery(async () => {
    const cards = await db.cards.where('folderId').anyOf(group.map((f) => f.id)).toArray();
    const out = {};
    for (const c of cards) if (!c.deleted) out[c.columnId] = (out[c.columnId] ?? 0) + 1;
    return out;
  }, [group.map((f) => f.id).join()]);
  const [mapping, setMapping] = useState(() => Object.fromEntries(from.map((c) => [c.id, matchColumn(c, to)?.id])));

  async function submit(e) {
    e.preventDefault();
    await changeFolderColumnSet(folder.id, setId, mapping);
    onClose();
  }

  return (
    <Modal title="Сменить набор колонок" onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <p>
          У папки «{folder.name}»{group.length > 1 && ' и вложенных в неё папок, которые берут набор у неё,'} будут колонки
          набора «{set?.name}»: {to.map((c) => c.name).join(', ')}.
          Выберите, куда перенести карточки из текущих колонок.
        </p>
        {to.length === 0 && <p className="notice">В наборе «{set?.name}» нет колонок — сначала добавьте их.</p>}
        {to.length > 0 && from.map((c) => (
          <label key={c.id} className="field">
            <span className="field-label">«{c.name}» — карточек: {counts?.[c.id] ?? 0}</span>
            <select className="select" value={mapping[c.id]}
              onChange={(e) => setMapping((m) => ({ ...m, [c.id]: e.target.value }))}>
              {to.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ))}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={to.length === 0}>Сменить набор</button>
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
    <Modal title="Удалить папку" onClose={onClose}>
      <p>
        В папке «{folder.name}»: карточек {stats.cards}
        {stats.folders > 0 && `, вложенных папок ${stats.folders} (в них карточек ${stats.subCards})`}. Что с ними сделать?
      </p>
      {stats.cards > 0 && (
        <FolderSelect label="Карточки папки оставить в папке" folders={folders} exclude={new Set([folder.id])}
          value={targetId} onChange={setTargetId} />
      )}
      {error && <p className="login-error">{error}</p>}
      <div className="actions">
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn" disabled={stats.cards > 0 && !targetId} onClick={() => finish(true)}>
          Оставить карточки{stats.folders > 0 ? ' и вложенные папки' : ''}
        </button>
        <button className="btn btn-danger" onClick={() => finish(false)}>
          Удалить {total > 0 || stats.folders > 0 ? 'всё' : 'папку'}
        </button>
      </div>
    </Modal>
  );
}

function AccessEditor({ folders, folder, onFolder }) {
  return (
    <div className="manage manage-access">
      <FolderSelect folders={folders} value={folder.id} onChange={onFolder} />
      <FolderMembers folder={folder} folders={folders} />
      <PublicLinkSettings folder={folder} />
    </div>
  );
}

const TAB_KEY = 'manageDialogTab';

/**
 * `initialSetId` is the column set opened on the «Колонки» tab and `initialFolderId` the folder
 * of the «Доступ» tab. `folders` are the live folders of the board, `writable` the ids a member may
 * change (null: all). The folders are arranged on «Папки» (members arrange those they have access to).
 */
export default function ManageDialog({
  model, columnsSynced, initialSetId, initialFolderId, folders, foldersSynced, writable, onClose,
}) {
  const canShare = useCanShare();
  const tabs = [
    { id: 'structure', label: 'Папки' },
    ...(canShare ? [{ id: 'access', label: 'Доступ' }] : []),
    ...(isOwnBoard ? [{ id: 'columns', label: 'Колонки' }] : []),
  ];
  const [deleting, setDeleting] = useState(null);
  const [changingSet, setChangingSet] = useState(null);
  const [savedTab, setTab] = useState(() => localStorage.getItem(TAB_KEY));
  const tab = tabs.some((t) => t.id === savedTab) ? savedTab : tabs[0].id;
  const [folderId, setFolderId] = useState(initialFolderId);
  const folder = folders.find((f) => f.id === folderId) ?? folders[0];

  function selectTab(id) {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
  }

  async function removeFolder(folder) {
    const stats = await folderStats(folder.id);
    if (stats.cards + stats.subCards + stats.folders > 0) setDeleting({ folder, stats });
    else if (confirm(`Удалить папку «${folder.name}»?`)) await deleteFolder(folder.id);
  }

  // Cards have to be placed in the new columns; an empty folder just switches.
  async function changeSet(folder, setId) {
    const next = folderColumnSetId({ ...folder, columnSetId: setId }, folders);
    if (next !== folderColumnSetId(folder, folders) && await countInheritingCards(folder.id)) {
      setChangingSet({ folder, setId });
    } else {
      await changeFolderColumnSet(folder.id, setId, {});
    }
  }

  return (
    <Modal title="Настройки доски" onClose={onClose}>
      {tabs.length > 1 && <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>}
      {tab === 'structure' && (
        <div role="tabpanel">
          <StructureEditor model={model} folders={folders} synced={foldersSynced} columnsSynced={columnsSynced}
            writable={writable} onChangeSet={changeSet} onRemoveFolder={removeFolder} />
        </div>
      )}
      {tab === 'access' && !folder && (
        <p className="muted">Сначала создайте папку на вкладке «Папки».</p>
      )}
      {tab === 'access' && folder && (
        <div role="tabpanel">
          <AccessEditor folders={folders} folder={folder} onFolder={setFolderId} />
        </div>
      )}
      {tab === 'columns' && (
        <div role="tabpanel">
          <ColumnSetsEditor model={model} synced={columnsSynced} initialSetId={initialSetId} />
        </div>
      )}
      {changingSet && (
        <ChangeSetDialog model={model} folder={changingSet.folder} folders={folders} setId={changingSet.setId}
          onClose={() => setChangingSet(null)} />
      )}
      <div className="actions">
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>

      {deleting && (
        <DeleteFolderDialog folder={deleting.folder} stats={deleting.stats} folders={folders}
          onClose={() => setDeleting(null)} />
      )}
    </Modal>
  );
}

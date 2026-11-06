import { useState } from 'react';
import { deleteFolder, folderStats } from '../actions.js';
import FolderSelect from './FolderSelect.jsx';
import Modal from './Modal.jsx';
import SharingSection from './SharingSection.jsx';
import StructureEditor from './StructureEditor.jsx';

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

const TABS = [
  { id: 'folders', label: 'Доски' },
  { id: 'sharing', label: 'Доступ' },
];
const TAB_KEY = 'manageDialogTab';

/**
 * The folders of the board (`folders`, live) and who has access to them; `writable` are the ids a member may change (null: all),
 * members arrange those they have access to. Columns are edited from the board («Изменить колонки»).
 */
export default function ManageDialog({ model, columnsSynced, folders, foldersSynced, writable, onClose }) {
  const [deleting, setDeleting] = useState(null);
  const [picked, setTab] = useState(() => localStorage.getItem(TAB_KEY));
  const tab = TABS.some((t) => t.id === picked) ? picked : TABS[0].id;

  function selectTab(id) {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
  }

  async function removeFolder(folder) {
    const stats = await folderStats(folder.id);
    if (stats.cards + stats.subCards + stats.folders > 0) setDeleting({ folder, stats });
    else if (confirm(`Удалить доску «${folder.name}»?`)) await deleteFolder(folder.id);
  }

  return (
    <Modal title="Настройки пространства" onClose={onClose}>
      <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel">
        {tab === 'sharing' ? <div className="manage"><SharingSection /></div> : (
          <StructureEditor model={model} folders={folders} synced={foldersSynced} columnsSynced={columnsSynced}
            writable={writable} onRemoveFolder={removeFolder} />
        )}
      </div>
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

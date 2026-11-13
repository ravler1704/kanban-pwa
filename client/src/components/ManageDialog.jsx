import { useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { isOwnBoard } from '../board.js';
import Modal from './Modal.jsx';
import SharingSection from './SharingSection.jsx';
import { SpaceSettings } from './Spaces.jsx';
import StructureEditor from './StructureEditor.jsx';

const TAB_KEY = 'manageDialogTab';

/**
 * The folders of the board (`folders`, live) and who has access to them; `writable` are the ids a member may change (null: all),
 * members arrange those they have access to. A board's columns are edited from its menu here or from the board.
 */
export default function ManageDialog({
  model, columnsSynced, folders, foldersSynced, writable, onClose, onBoardCreated,
}) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const tabs = [
    ...(isOwnBoard && user ? [{ id: 'space', label: 'Пространство' }] : []),
    { id: 'folders', label: 'Доски' },
    { id: 'sharing', label: 'Доступ' },
  ];
  const [picked, setTab] = useState(() => localStorage.getItem(TAB_KEY));
  const tab = tabs.some((t) => t.id === picked) ? picked : 'folders';

  function selectTab(id) {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
  }

  return (
    <Modal title="Настройки пространства" onClose={onClose}>
      <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel">
        {tab === 'space' && <SpaceSettings />}
        {tab === 'sharing' && <div className="manage"><SharingSection /></div>}
        {tab === 'folders' && (
          <StructureEditor model={model} folders={folders} synced={foldersSynced} columnsSynced={columnsSynced}
            writable={writable} onBoardCreated={onBoardCreated} />
        )}
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

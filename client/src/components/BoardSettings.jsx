import { setFolderDoneMarks } from '../actions.js';
import { folderDoneMarks } from '../appearance.js';
import { SwitchRow } from './FolderFilter.jsx';
import Modal from './Modal.jsx';

/**
 * The board's own settings, as iOS switches; they apply at once. A board inside another follows the
 * parent's until switched the other way.
 */
export default function BoardSettings({ folder, folders, onClose }) {
  const parent = folders.find((f) => f.id === folder.parentId) ?? null;
  const fromParent = parent ? folderDoneMarks(parent, folders) : true;
  const doneMarks = folderDoneMarks(folder, folders);
  const inherited = parent && typeof folder.doneMarks !== 'boolean';

  return (
    <Modal title={`Настройки доски «${folder.name}»`} onClose={onClose} className="folder-picker board-settings" closeButton>
      <ul className="fp-list ff-group">
        <SwitchRow label="Отметка «Выполнена» у карточек" on={doneMarks}
          meta={inherited ? `Как у «${parent.name}»` : 'Кружок с галочкой у названия, как в Trello'}
          onChange={(on) => setFolderDoneMarks(folder.id, on === fromParent && parent ? null : on)} />
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

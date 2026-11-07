import { setFolderDoneMarks } from '../actions.js';
import { folderDoneMarks } from '../appearance.js';
import { SwitchRow } from './FolderFilter.jsx';
import Modal from './Modal.jsx';
import { useOpenSpace } from './Spaces.jsx';

/**
 * The board's own settings, as iOS switches; they apply at once. A board follows the board it is in (a
 * top one, the space's settings) until switched the other way.
 */
export default function BoardSettings({ folder, folders, onClose }) {
  const space = useOpenSpace();
  const parent = folders.find((f) => f.id === folder.parentId) ?? null;
  const fromAbove = parent ? folderDoneMarks(parent, folders, space.doneMarks) : space.doneMarks;
  const doneMarks = folderDoneMarks(folder, folders, space.doneMarks);
  const inherited = typeof folder.doneMarks !== 'boolean';

  return (
    <Modal title={`Настройки доски «${folder.name}»`} onClose={onClose} className="folder-picker board-settings" closeButton>
      <ul className="fp-list ff-group">
        <SwitchRow label="Отметка «Выполнена» у карточек" on={doneMarks}
          meta={inherited ? (parent ? `Как у «${parent.name}»` : 'Как у пространства') : 'Своя настройка доски'}
          onChange={(on) => setFolderDoneMarks(folder.id, on === fromAbove ? null : on)} />
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

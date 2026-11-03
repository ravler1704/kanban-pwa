import { useState } from 'react';
import { createCard } from '../actions.js';
import CardExtraFields from './CardExtraFields.jsx';
import FolderSelect from './FolderSelect.jsx';
import Modal from './Modal.jsx';
import TitleField from './TitleField.jsx';

/**
 * `folders` are the folders a card can be added to and `target` the one preselected (an id; else the
 * first folder).
 */
export default function NewCardDialog({ folders, columnsOfFolder, target, onClose }) {
  const [folderId, setFolderId] = useState(() => (folders.some((f) => f.id === target) ? target : folders[0]?.id) ?? '');
  // The folder's column set decides the choice. New cards land in «Входящие» (the default
  // backlog column) or the first column; a picked column is kept by name across sets.
  const columns = folderId ? columnsOfFolder(folderId) : [];
  const [picked, setPicked] = useState(null);
  const column = columns.find((c) => c.id === picked?.id)
    ?? (picked && columns.find((c) => c.name === picked.name))
    ?? columns.find((c) => c.id === 'backlog')
    ?? columns[0];
  const columnId = column?.id ?? '';
  const setColumnId = (id) => setPicked(columns.find((c) => c.id === id));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reminders, setReminders] = useState([]);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !folderId || !columnId) return;
    await createCard({ folderId }, columnId, title.trim(), description, reminders);
    onClose();
  }

  return (
    <Modal title="Новая карточка" onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <TitleField value={title} onChange={setTitle} />
        <CardExtraFields
          description={description}
          onDescription={setDescription}
          reminders={reminders}
          onReminders={setReminders}
          descriptionRows={4}
        />
        <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />
        <label className="field">
          <span className="field-label">Колонка</span>
          <select className="select" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Добавить</button>
        </div>
      </form>
    </Modal>
  );
}

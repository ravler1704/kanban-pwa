import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { changeFolderColumnSet } from '../actions.js';
import { matchColumn } from '../columnSets.js';
import { db } from '../db.js';
import { folderColumnSetId, inheritingFolders } from '../folders.js';
import Modal from './Modal.jsx';

/**
 * Switching a folder to another column set (`setId`, null: the ancestor's): where the cards of each
 * current column go, also those of the subfolders that take their set from this folder.
 */
export default function ChangeSetDialog({ model, folder, folders, setId, onClose }) {
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
          У доски «{folder.name}»{group.length > 1 && ' и вложенных в неё досок, которые берут набор у неё,'} будут колонки
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

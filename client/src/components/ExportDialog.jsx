import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { descendants, flattenFolders, folderTree, topFolderIds } from '../folders.js';
import { personName, peopleStore } from '../people.js';
import Modal from './Modal.jsx';
import { useOpenSpace } from './Spaces.jsx';

function FolderCheckbox({ folder, depth, checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <li>
      <label className="export-board" style={{ paddingLeft: `${0.6 + depth * 1.2}rem` }}>
        <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="export-board-name">{folder.name || 'Без названия'}</span>
      </label>
    </li>
  );
}

/**
 * Downloads cards as an Excel workbook: the board in view (`current`: its folder ids, with the boards inside it
 * that are shown; null when several boards are in view), boards picked in the tree, or the whole space (with
 * «Входящие» when `inbox`). Built on this device from the local data, so it works offline.
 */
export default function ExportDialog({ folders, current, checkedIds, inbox, onClose }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const people = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const space = useOpenSpace();
  const tree = folderTree(folders);
  const currentTop = current ? tree.byId.get(topFolderIds(current, folders)[0]) : null;
  const [scope, setScope] = useState(currentTop ? 'current' : 'boards');
  const [picked, setPicked] = useState(() => new Set(checkedIds?.length ? checkedIds : folders.map((f) => f.id)));
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const subtree = (id) => [id, ...descendants(folders, id).map((f) => f.id)];
  const toggle = (id, on) => setPicked((set) => {
    const next = new Set(set);
    for (const x of subtree(id)) {
      if (on) next.add(x);
      else next.delete(x);
    }
    return next;
  });
  const partial = (id) => {
    const inside = descendants(folders, id);
    const n = inside.filter((f) => picked.has(f.id)).length;
    return n > 0 && (n < inside.length || !picked.has(id));
  };
  const pickedIds = folders.filter((f) => picked.has(f.id)).map((f) => f.id);
  const pickedTops = topFolderIds(pickedIds, folders).map((id) => tree.byId.get(id));

  const spaceName = space.title || 'пространство';
  const ids = scope === 'current' ? current : scope === 'boards' ? pickedIds : folders.map((f) => f.id);
  const title = scope === 'current' ? currentTop?.name
    : scope === 'boards' && pickedTops.length === 1 ? pickedTops[0].name : spaceName;
  const empty = !ids?.length && !(scope === 'space' && inbox);

  async function submit(e) {
    e.preventDefault();
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    try {
      const names = new Map(people.map((p) => [p.id, personName(p)]));
      if (user?.id) names.set(user.id, personName(user));
      const { buildWorkbook, download, exportFileName } = await import('../exportXlsx.js');
      const { blob } = await buildWorkbook({
        folders, folderIds: ids, inbox: scope === 'space' && inbox, includeArchived: archived, names,
      });
      download(blob, exportFileName(title));
      onClose();
    } catch (err) {
      setError(err.message || 'Не удалось сформировать файл');
      setBusy(false);
    }
  }

  const option = (value, label, meta, disabled = false) => (
    <label className={`export-option ${disabled ? 'disabled' : ''}`}>
      <input type="radio" name="export-scope" value={value} checked={scope === value} disabled={disabled}
        onChange={() => setScope(value)} />
      <span className="export-option-text">
        <span>{label}</span>
        {meta && <span className="muted export-option-meta">{meta}</span>}
      </span>
    </label>
  );
  const insideCurrent = current ? current.length - 1 : 0;

  return (
    <Modal title="Выгрузить в Excel" onClose={onClose} className="export-dialog">
      <form className="editor" onSubmit={submit}>
        <div className="field export-group">
          <span className="field-label">Что выгрузить</span>
          {option('current', 'Текущая доска', currentTop
            ? `«${currentTop.name}»${insideCurrent > 0 ? ` и вложенные доски (${insideCurrent})` : ''}`
            : 'Сейчас на экране несколько досок', !currentTop)}
          {option('boards', 'Несколько досок', scope === 'boards' ? `Отмечено: ${pickedIds.length}` : null)}
          {option('space', 'Всё пространство', `«${spaceName}»: все доски${inbox ? ' и «Входящие»' : ''}`)}
        </div>
        {scope === 'boards' && (
          <div className="field export-group">
            <span className="field-label">Доски</span>
            <div className="export-board-tools">
              <button type="button" className="btn btn-small" onClick={() => setPicked(new Set(folders.map((f) => f.id)))}>
                Отметить все
              </button>
              <button type="button" className="btn btn-small" onClick={() => setPicked(new Set())}>Снять все</button>
            </div>
            <ul className="export-boards">
              {flattenFolders(folders).map(({ folder, depth }) => (
                <FolderCheckbox key={folder.id} folder={folder} depth={depth} checked={picked.has(folder.id)}
                  indeterminate={partial(folder.id)} onChange={(on) => toggle(folder.id, on)} />
              ))}
            </ul>
          </div>
        )}
        <label className="export-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Включить карточки из архива
        </label>
        <p className="muted export-note">
          Лист «Все карточки» со всеми выбранными карточками{scope === 'current' && insideCurrent === 0 ? '' : ' и по листу на каждую доску с карточками'}.
          Файл собирается на этом устройстве и выгружается без интернета.
        </p>
        {error && <p className="login-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy || empty}>{busy ? 'Готовлю файл…' : 'Скачать'}</button>
        </div>
      </form>
    </Modal>
  );
}

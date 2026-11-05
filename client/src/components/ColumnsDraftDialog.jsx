import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { editColumnSet, forkColumnSet } from '../actions.js';
import { db } from '../db.js';
import { inheritingFolders } from '../folders.js';
import Modal from './Modal.jsx';

const svg = (d) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const UP = 'm6 15 6-6 6 6';
const DOWN = 'm6 9 6 6 6-6';
const REMOVE = 'M18 6 6 18M6 6l12 12';

let lastKey = 0;
const rowOf = (c) => ({ key: c.id, id: c.id, name: c.name, addToTop: !!c.addToTop });
const quoted = (folders) => folders.map((f) => `«${f.name}»`).join(', ');

/**
 * Edits the columns of the board's set (`setId`) as a draft; on saving, the changes go either into the set
 * (every board using it) or into a new set for `folder` (null: only the first is possible).
 */
export default function ColumnsDraftDialog({ model, setId, folder, folders, onClose }) {
  const set = model.sets.find((s) => s.id === setId);
  const original = model.columnsOf(setId);
  const [rows, setRows] = useState(() => original.map(rowOf));
  const [newName, setNewName] = useState('');
  const [moves, setMoves] = useState({});
  const [step, setStep] = useState('edit');
  const [mode, setMode] = useState('set');
  const [setName, setSetName] = useState(() => (folder ? folder.name : `${set?.name ?? 'Набор'} — копия`));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const counts = useLiveQuery(async () => {
    const ids = new Set(original.map((c) => c.id));
    const out = {};
    await db.cards.each((c) => {
      if (!c.deleted && ids.has(c.columnId)) out[c.columnId] = (out[c.columnId] ?? 0) + 1;
    });
    return out;
  }, [original.map((c) => c.id).join()]) ?? {};

  const users = model.foldersOf(setId);
  const group = folder ? inheritingFolders(folder, folders) : [];
  const others = users.filter((f) => !group.some((g) => g.id === f.id));

  const removed = original.filter((c) => !rows.some((r) => r.id === c.id));
  const withCards = removed.filter((c) => counts[c.id] > 0);
  const targetOf = (c) => (rows.some((r) => r.key === moves[c.id]) ? moves[c.id] : rows[0]?.key);
  const valid = rows.length > 0 && rows.every((r) => r.name.trim());
  const changed = removed.length > 0 || rows.length !== original.length
    || rows.some((r, i) => r.id !== original[i]?.id || r.name.trim() !== original[i].name);

  const patch = (key, p) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i, d) => setRows((list) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const remove = (key) => setRows((list) => list.filter((r) => r.key !== key));
  function add(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    lastKey += 1;
    setRows((list) => [...list, { key: `new-${lastKey}`, id: null, name: name.slice(0, 100), addToTop: false }]);
    setNewName('');
  }

  async function apply() {
    const clean = rows.map((r) => ({ ...r, name: r.name.trim().slice(0, 100) }));
    const chosen = Object.fromEntries(removed.map((c) => [c.id, targetOf(c)]));
    setSaving(true);
    setError(null);
    try {
      if (mode === 'set') await editColumnSet(setId, clean, chosen);
      else await forkColumnSet(folder.id, setName.trim().slice(0, 100), setId, clean, chosen);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (step === 'apply') {
    return (
      <Modal title="Применить изменения колонок" onClose={onClose} className="columns-draft" closeButton>
        <div className="columns-apply" role="radiogroup" aria-label="Как применить">
          <label className={`apply-option ${mode === 'set' ? 'apply-option-on' : ''}`}>
            <input type="radio" name="apply" checked={mode === 'set'} onChange={() => setMode('set')} />
            <span>
              <strong>Изменить набор «{set?.name}»</strong>
              <span className="muted">
                {others.length
                  ? `Колонки изменятся везде, где используется этот набор: ${quoted(users)}.`
                  : 'Набор используется только здесь — колонки изменятся у этой доски.'}
              </span>
            </span>
          </label>
          {folder && (
            <label className={`apply-option ${mode === 'new' ? 'apply-option-on' : ''}`}>
              <input type="radio" name="apply" checked={mode === 'new'} onChange={() => setMode('new')} />
              <span>
                <strong>Создать новый набор для доски «{folder.name}»</strong>
                <span className="muted">
                  {group.length > 1 ? `Его получат «${folder.name}» и вложенные доски, которые берут набор у неё. ` : ''}
                  {others.length ? `У ${quoted(others)} останется набор «${set?.name}» без изменений.` : `Набор «${set?.name}» останется без изменений.`}
                </span>
              </span>
            </label>
          )}
          {mode === 'new' && (
            <label className="field manage-field">
              <span className="field-label">Название нового набора</span>
              <input className="manage-input" value={setName} maxLength={100} onChange={(e) => setSetName(e.target.value)} />
            </label>
          )}
        </div>
        {error && <p className="login-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={() => setStep('edit')}>Назад</button>
          <button type="button" className="btn btn-primary" onClick={apply}
            disabled={saving || (mode === 'new' && !setName.trim())}>Применить</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Колонки доски" onClose={onClose} className="columns-draft" closeButton>
      <p className="muted columns-draft-hint">
        Набор «{set?.name}». Изменения применятся, когда вы нажмёте «Сохранить» и выберете, к чему их применить.
      </p>
      <ol className="draft-columns">
        {rows.map((r, i) => (
          <li key={r.key} className="draft-column">
            <input className="manage-input" value={r.name} maxLength={100} aria-label={`Название колонки ${i + 1}`}
              onChange={(e) => patch(r.key, { name: e.target.value })} />
            <button type="button" className="btn btn-small btn-icon-only" title="Выше (левее на доске)" aria-label="Выше"
              disabled={i === 0} onClick={() => move(i, -1)}>{svg(UP)}</button>
            <button type="button" className="btn btn-small btn-icon-only" title="Ниже (правее на доске)" aria-label="Ниже"
              disabled={i === rows.length - 1} onClick={() => move(i, 1)}>{svg(DOWN)}</button>
            <button type="button" className="btn btn-small btn-icon-only btn-danger" title="Удалить колонку"
              aria-label="Удалить колонку" disabled={rows.length === 1} onClick={() => remove(r.key)}>{svg(REMOVE)}</button>
          </li>
        ))}
      </ol>
      <form className="manage-add draft-add" onSubmit={add}>
        <input className="manage-input" value={newName} maxLength={100} placeholder="Новая колонка"
          aria-label="Новая колонка" onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="btn" disabled={!newName.trim()}>Добавить</button>
      </form>
      {withCards.length > 0 && rows.length > 0 && (
        <div className="draft-moves">
          {withCards.map((c) => (
            <label key={c.id} className="field">
              <span className="field-label">Карточки из «{c.name}» ({counts[c.id]}) перенести в</span>
              <select className="select" value={targetOf(c)}
                onChange={(e) => setMoves((m) => ({ ...m, [c.id]: e.target.value }))}>
                {rows.map((r) => <option key={r.key} value={r.key}>{r.name.trim() || 'Без названия'}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-primary" disabled={!valid || !changed}
          title={!valid ? 'У каждой колонки должно быть название' : undefined}
          onClick={() => setStep('apply')}>Сохранить</button>
      </div>
    </Modal>
  );
}

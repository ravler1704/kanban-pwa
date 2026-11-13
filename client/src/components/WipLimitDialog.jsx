import { useState } from 'react';
import Modal from './Modal.jsx';

/** Set or clear the column's WIP limit. */
export default function WipLimitDialog({ column, edit, onSave, onClose }) {
  const [draft, setDraft] = useState(column.wipLimit != null ? String(column.wipLimit) : '');
  const save = (e) => {
    e.preventDefault();
    const trimmed = draft.trim();
    const limit = trimmed === '' ? null : Math.min(999, Math.max(1, parseInt(trimmed, 10)));
    if (trimmed !== '' && !Number.isFinite(limit)) return;
    onSave(limit);
    onClose();
  };
  return (
    <Modal title={`WIP-лимит — «${column.name}»`} onClose={onClose}>
      <form className="editor" onSubmit={save}>
        <p className="muted columns-draft-hint">
          Максимум активных карточек в колонке. При превышении лимита доска подсветит счётчик и спросит
          подтверждение при переносе.
        </p>
        <label className="field manage-field">
          <span className="field-label">Лимит (пусто — без лимита)</span>
          <input className="manage-input" type="number" min={1} max={999} step={1} value={draft}
            placeholder="Без лимита" onChange={(e) => setDraft(e.target.value)} />
        </label>
        {edit?.boards?.length > 1 && (
          <p className="muted account-hint">
            Набор «{edit.setName}» используют доски: {edit.boards.map((b) => `«${b}»`).join(', ')}.
          </p>
        )}
        <div className="actions">
          {column.wipLimit != null && (
            <button type="button" className="btn btn-danger" onClick={() => { onSave(null); onClose(); }}>
              Убрать лимит
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal.jsx';

export const DELETE_WORD = 'удалить';

/** The field where the word is typed to confirm a deletion: `[ok, field]`, `ok` once it's typed. */
export function useDeleteWord() {
  const [word, setWord] = useState('');
  const ok = word.trim().toLowerCase() === DELETE_WORD;
  const field = (
    <label className="field delete-word">
      <span className="field-label">Чтобы подтвердить, введите «{DELETE_WORD}»</span>
      <input className="manage-input" value={word} autoComplete="off" autoCapitalize="none" spellCheck={false}
        onChange={(e) => setWord(e.target.value)} />
    </label>
  );
  return [ok, field];
}

/** A deletion confirmed by typing the word: `onConfirm()` may be async; its error is shown. */
export default function ConfirmDelete({ title, children, confirmLabel = 'Удалить навсегда', onConfirm, onClose }) {
  const [ok, field] = useDeleteWord();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm(e) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return createPortal(
    <Modal title={title} onClose={busy ? () => {} : onClose} className="confirm-delete">
      <form onSubmit={confirm}>
        <p className="account-hint">{children}</p>
        {field}
        {error && <p className="login-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-danger" disabled={!ok || busy}>{busy ? 'Удаляем…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>,
    document.body,
  );
}

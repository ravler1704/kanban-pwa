import { useEffect, useState } from 'react';
import { createFolder } from '../actions.js';
import Modal from './Modal.jsx';
import TemplatePreview from './TemplatePreview.jsx';
import { createBoardFromTemplate } from '../templateApply.js';
import { listTemplates, noteTemplateUse } from '../templatesApi.js';

const STANDARD_PREVIEW = {
  columns: [
    { name: 'Запланировано', color: null },
    { name: 'В работе', color: 'blue' },
    { name: 'Завершено', color: 'green' },
  ],
  background: null,
};

/**
 * New folder with optional template. `parentId` null — root board (needs `defaultColumnSetId`).
 */
export default function NewBoardDialog({
  parentId = null,
  defaultColumnSetId,
  title = 'Новая доска',
  onClose,
  onCreated,
}) {
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState([]);
  const [pickedId, setPickedId] = useState('__standard__');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    listTemplates({ limit: 50 })
      .then((data) => { if (!cancel) setTemplates(data.templates ?? []); })
      .catch(() => { if (!cancel) setTemplates([]); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  const picked = pickedId === '__standard__'
    ? null
    : templates.find((t) => t.id === pickedId) ?? null;

  async function submit(e) {
    e.preventDefault();
    const boardName = name.trim();
    if (!boardName) return;
    setBusy(true);
    setError(null);
    try {
      let folderId;
      if (picked) {
        ({ folderId } = await createBoardFromTemplate(picked.payload, { boardName, parentId }));
        noteTemplateUse(picked.id).catch(() => {});
      } else {
        folderId = await createFolder(boardName, parentId
          ? { parentId }
          : { columnSetId: defaultColumnSetId });
      }
      onCreated?.(folderId);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} className="new-board-dialog" closeButton>
      <form className="new-board-form" onSubmit={submit}>
        <label className="field manage-field">
          <span className="field-label">Название</span>
          <input
            className="manage-input"
            value={name}
            maxLength={100}
            placeholder="Например, «Ремонт»"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <section className="new-board-section" aria-labelledby="new-board-template-label">
          <p id="new-board-template-label" className="new-board-section-title">Шаблон колонок</p>
          <p className="muted new-board-section-hint">
            Так будет выглядеть доска — фон, цвета колонок и заголовки.
          </p>
          <div className="template-pick-grid" role="listbox" aria-label="Шаблоны досок">
          <button
            type="button"
            role="option"
            aria-selected={pickedId === '__standard__'}
            className={`template-pick-card${pickedId === '__standard__' ? ' template-pick-on' : ''}`}
            onClick={() => setPickedId('__standard__')}
          >
            <TemplatePreview {...STANDARD_PREVIEW} />
            <span className="template-pick-label">Стандартные колонки</span>
          </button>
          {loading && <p className="muted">Загрузка шаблонов…</p>}
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={pickedId === t.id}
              className={`template-pick-card${pickedId === t.id ? ' template-pick-on' : ''}`}
              onClick={() => setPickedId(t.id)}
            >
              <TemplatePreview columns={t.payload.columns} background={t.payload.background} />
              <span className="template-pick-label">{t.title}</span>
            </button>
          ))}
          </div>
        </section>
        {error && <p className="login-error new-board-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Создаём…' : 'Создать доску'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

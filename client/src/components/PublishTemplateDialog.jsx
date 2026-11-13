import { useState } from 'react';
import { folderDoneMarks } from '../appearance.js';
import { payloadFromSet } from '../templateApply.js';
import { publishTemplate } from '../templatesApi.js';
import Modal from './Modal.jsx';

/** Publish the current column draft as a public template. */
export default function PublishTemplateDialog({
  setName, rows, originalColumns, folder, folders, space, onClose,
}) {
  const [title, setTitle] = useState(() => setName?.trim() || 'Шаблон доски');
  const [description, setDescription] = useState('');
  const [includeBoard, setIncludeBoard] = useState(Boolean(folder));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const validRows = rows.filter((r) => r.name.trim());

  async function submit(e) {
    e.preventDefault();
    if (!validRows.length) return;
    setSaving(true);
    setError(null);
    try {
      const doneMarks = folder && includeBoard
        ? folderDoneMarks(folder, folders, space?.doneMarks ?? null)
        : null;
      const background = folder && includeBoard ? (folder.background ?? null) : null;
      const payload = payloadFromSet(
        setName,
        validRows.map((r) => {
          const orig = originalColumns?.find((c) => c.id === r.id);
          return {
            name: r.name.trim(),
            addToTop: r.addToTop,
            wipLimit: r.wipLimit,
            color: orig?.color ?? null,
          };
        }),
        { doneMarks: typeof doneMarks === 'boolean' ? doneMarks : null, background },
      );
      await publishTemplate({
        title: title.trim(),
        description: description.trim(),
        payload,
      });
      onClose(true);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Опубликовать шаблон" onClose={() => onClose(false)} className="publish-template" closeButton>
      <form className="editor" onSubmit={submit}>
        <p className="muted">
          Шаблон появится в общей витрине. Будут указаны ваше имя и настройки колонок; карточки не публикуются.
        </p>
        <label className="field">
          <span className="field-label">Название шаблона</span>
          <input className="manage-input" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea className="manage-input" rows={3} maxLength={2000} value={description}
            placeholder="Для кого подходит, как пользоваться…"
            onChange={(e) => setDescription(e.target.value)} />
        </label>
        {folder && (
          <label className="radio-option">
            <input type="checkbox" checked={includeBoard} onChange={(e) => setIncludeBoard(e.target.checked)} />
            Добавить в шаблон фон доски и настройку «Отметка выполнена»
          </label>
        )}
        <p className="muted">
          Колонки: {validRows.map((r) => r.name.trim()).join(' · ')}
        </p>
        {error && <p className="login-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={() => onClose(false)}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>Опубликовать</button>
        </div>
      </form>
    </Modal>
  );
}

import { useState, useSyncExternalStore } from 'react';
import { attachFiles, dismissUpload, fileUrl, formatSize, isImage, removeFile, uploadStore } from '../files.js';
import { syncStatus } from '../sync.js';

/** Files of the card: image thumbnails and a list of the others; `readOnly` only shows them. */
export default function Attachments({ card, readOnly }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const uploads = useSyncExternalStore(uploadStore.subscribe, uploadStore.get).filter((u) => u.cardId === card.id);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const files = card.attachments ?? [];
  const images = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  // The server adds files to the card it has: a card created offline has to sync first.
  const canAttach = !readOnly && online && Boolean(card.server);

  function attach(list) {
    if (!canAttach || !list.length) return;
    attachFiles(card.id, [...list]);
  }

  async function remove(file) {
    if (!confirm(`Удалить файл «${file.name}»?`)) return;
    setError(null);
    try {
      await removeFile(card.id, file.id);
    } catch (err) {
      setError(err.message);
    }
  }

  if (readOnly && files.length === 0) return null;

  const removeButton = (file) => !readOnly && (
    <button type="button" className="attachment-remove" title="Удалить файл" aria-label={`Удалить ${file.name}`}
      disabled={!online} onClick={() => remove(file)}>×</button>
  );

  return (
    <section
      className={`attachments ${dragOver ? 'attachments-drop' : ''}`}
      onDragOver={(e) => {
        if (!canAttach || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canAttach || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        attach(e.dataTransfer.files);
      }}
    >
      <div className="attachments-head">
        <span className="attachments-title">Файлы{files.length > 0 && ` · ${files.length}`}</span>
        {!readOnly && (
          <label className={`btn btn-small ${canAttach ? '' : 'btn-disabled'}`}>
            Прикрепить
            <input type="file" multiple hidden disabled={!canAttach}
              onChange={(e) => {
                attach(e.target.files);
                e.target.value = '';
              }} />
          </label>
        )}
      </div>
      {images.length > 0 && (
        <div className="attachment-thumbs">
          {images.map((f) => (
            <div key={f.id} className="attachment-thumb">
              <a href={fileUrl(f)} target="_blank" rel="noreferrer" title={`${f.name} · ${formatSize(f.size)}`}>
                <img src={fileUrl(f)} alt={f.name} loading="lazy" />
              </a>
              {removeButton(f)}
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <ul className="attachment-list">
          {others.map((f) => (
            <li key={f.id} className="attachment-row">
              <a href={fileUrl(f, { download: true })} className="attachment-name" title="Скачать">{f.name}</a>
              <span className="attachment-size muted">{formatSize(f.size)}</span>
              {removeButton(f)}
            </li>
          ))}
        </ul>
      )}
      {uploads.map((u) => (u.error ? (
        <div key={u.key} className="attachment-row attachment-failed">
          <span className="attachment-name" title={u.error}>{u.name}</span>
          <span className="attachment-size">{u.error}</span>
          <button type="button" className="attachment-remove" title="Убрать" aria-label="Убрать"
            onClick={() => dismissUpload(u.key)}>×</button>
        </div>
      ) : (
        <div key={u.key} className="attachment-row attachment-uploading">
          <span className="attachment-name">{u.name}</span>
          <span className="attachment-size muted">{Math.round(u.progress * 100)}%</span>
          <progress max="1" value={u.progress} />
        </div>
      )))}
      {!readOnly && !online && <p className="muted attachments-hint">Файлы прикрепляются и удаляются только при подключении к интернету.</p>}
      {!readOnly && online && !card.server && (
        <p className="muted attachments-hint">Файлы можно будет прикрепить, когда карточка синхронизируется.</p>
      )}
      {uploads.some((u) => !u.error) && (
        <p className="muted attachments-hint">Загрузка продолжится, если закрыть карточку; не закрывайте вкладку.</p>
      )}
      {!readOnly && canAttach && files.length === 0 && uploads.length === 0 && (
        <p className="muted attachments-hint">Нажмите «Прикрепить» или перетащите файлы сюда.</p>
      )}
      {error && <p className="login-error">{error}</p>}
    </section>
  );
}

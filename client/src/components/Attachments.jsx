import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  attachFiles, dismissUpload, fileUrl, formatSize, isImage, isVideo, removeFile, uploadStore,
} from '../files.js';
import { syncStatus } from '../sync.js';
import Modal from './Modal.jsx';

function VideoPlayer({ file, onClose }) {
  // Outside the card editor's form and its scrolling box.
  return createPortal(
    <Modal title={file.name} onClose={onClose}>
      <div className="video-player">
        <video src={fileUrl(file)} controls autoPlay playsInline />
        <div className="actions">
          <a className="btn" href={fileUrl(file, { download: true })}>Скачать · {formatSize(file.size)}</a>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}

function PlayIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="rgb(0 0 0 / 0.55)" />
      <path d="M10 8l6 4-6 4z" fill="#fff" />
    </svg>
  );
}

/** Files of the card: image thumbnails and a list of the others; `readOnly` only shows them. */
export default function Attachments({ card, readOnly }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const uploads = useSyncExternalStore(uploadStore.subscribe, uploadStore.get).filter((u) => u.cardId === card.id);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [playing, setPlaying] = useState(null);
  const files = card.attachments ?? [];
  const thumbs = files.filter((f) => isImage(f) || isVideo(f));
  const others = files.filter((f) => !isImage(f) && !isVideo(f));
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
      {thumbs.length > 0 && (
        <div className="attachment-thumbs">
          {thumbs.map((f) => (
            <div key={f.id} className="attachment-thumb">
              {isVideo(f) ? (
                <button type="button" className="attachment-video" title={`${f.name} · ${formatSize(f.size)}`}
                  onClick={() => setPlaying(f)}>
                  {/* The first frame as the preview. */}
                  <video src={`${fileUrl(f)}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} />
                  <PlayIcon />
                </button>
              ) : (
                <a href={fileUrl(f)} target="_blank" rel="noreferrer" title={`${f.name} · ${formatSize(f.size)}`}>
                  <img src={fileUrl(f)} alt={f.name} loading="lazy" />
                </a>
              )}
              {removeButton(f)}
            </div>
          ))}
        </div>
      )}
      {playing && <VideoPlayer file={playing} onClose={() => setPlaying(null)} />}
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

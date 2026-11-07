import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EventDiff, EventText, parseEvent, useCardNumbers } from '../chatEvents.jsx';
import {
  chatImageUrl, compressByDefault, isImageFile, rememberCompress, shownId, uploadChatImage,
} from '../chatImages.js';
import { formatSize, isImage } from '../files.js';
import { pasteAsLink } from '../links.js';
import Avatar from './Avatar.jsx';
import { useLinkMenu } from './LinkMenu.jsx';
import Markdown from './Markdown.jsx';

// Phones put a line break on Enter; elsewhere Enter sends and Shift+Enter breaks the line.
const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches;
const GROUP_MS = 5 * 60 * 1000;

const time = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** Whether `m` goes on in the same bubble group as `prev`: one author, within minutes, the same day. */
const continues = (prev, m) => Boolean(prev && m && !prev.event && !m.event && prev.authorId === m.authorId
  && m.createdAt - prev.createdAt < GROUP_MS && sameDay(prev.createdAt, m.createdAt));

/** The same hue as the person's letter avatar, so a name matches its avatar. */
function nameHue(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}

function Ticks({ pending }) {
  return pending ? (
    <svg className="chat-ticks" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.25" strokeLinecap="round" aria-label="Не отправлено"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>
  ) : (
    <svg className="chat-ticks" width="16" height="14" viewBox="0 0 24 20" fill="none" stroke="currentColor"
      strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-label="Отправлено"><path d="m4 11 5 5L20 5" /></svg>
  );
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const days = Math.round((new Date(today).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}

const MAX_IMAGES = 10;

/** Pictures chosen for the next message, before sending: thumbnails, «Сжать» and the sizes. */
function PendingImages({ items, compress, onCompress, onRemove, status }) {
  const total = items.reduce((sum, i) => sum + i.file.size, 0);
  return (
    <div className="chat-pending">
      <div className="chat-pending-list">
        {items.map((i) => (
          <span key={i.key} className="chat-pending-item">
            <img src={i.url} alt="" />
            <button type="button" className="chat-pending-remove" onClick={() => onRemove(i.key)} disabled={Boolean(status)}
              aria-label={`Убрать «${i.file.name}»`} title="Убрать">×</button>
          </span>
        ))}
      </div>
      <div className="chat-pending-options">
        <label className="chat-pending-compress">
          <input type="checkbox" checked={compress} disabled={Boolean(status)} onChange={(e) => onCompress(e.target.checked)} />
          Сжать {items.length > 1 ? 'изображения' : 'изображение'}
        </label>
        <span className="muted">
          {status ?? (compress ? 'Быстрее отправка, меньше места' : `В оригинальном качестве · ${formatSize(total)}`)}
        </span>
      </div>
    </div>
  );
}

function Composer({ editing, onSubmit, onCancelEdit, placeholder, disabled, canAttach }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState([]);
  const [compress, setCompress] = useState(compressByDefault);
  const [status, setStatus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null);
  const input = useRef(null);
  const attaching = canAttach && !editing;

  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addImages(files) {
    const picked = [...files].filter(isImageFile);
    if (!picked.length) return false;
    setImages((list) => {
      const room = MAX_IMAGES - list.length;
      if (picked.length > room) alert(`В одном сообщении — не больше ${MAX_IMAGES} изображений.`);
      return [...list, ...picked.slice(0, Math.max(0, room)).map((file) => ({
        key: `${file.name}:${file.size}:${Math.random()}`, file, url: URL.createObjectURL(file),
      }))];
    });
    return true;
  }

  function removeImage(key) {
    setImages((list) => {
      const gone = list.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return list.filter((i) => i.key !== key);
    });
  }
  // Where the caret goes once the text changed by a paste is rendered.
  const caret = useRef(null);
  const linkMenu = useLinkMenu();

  useEffect(() => {
    if (!editing) return;
    setText(editing.text);
    input.current?.focus();
  }, [editing]);

  useLayoutEffect(() => {
    const el = input.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    if (caret.current != null) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  async function submit() {
    const value = text.trim();
    const withImages = attaching && images.length > 0;
    const emptyEdit = editing && !value && editing.images?.length;
    if ((!value && !withImages && !emptyEdit) || busy || disabled) return;
    setBusy(true);
    try {
      const uploaded = [];
      for (const [n, item] of (withImages ? images : []).entries()) {
        const label = images.length > 1 ? `Загрузка ${n + 1} из ${images.length}` : 'Загрузка';
        setStatus(`${label}…`);
        uploaded.push(await uploadChatImage(item.file, {
          compress,
          onProgress: (p) => setStatus(`${label}: ${Math.round(p * 100)}%`),
        }));
      }
      setStatus(null);
      await onSubmit(value, uploaded);
      setText('');
      images.forEach((i) => URL.revokeObjectURL(i.url));
      setImages([]);
    } catch (err) {
      setStatus(null);
      alert(err.message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className={`chat-composer ${dragging ? 'chat-composer-drop' : ''}`}
      onDragOver={(e) => {
        if (!attaching || disabled || ![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (!attaching || disabled) return;
        e.preventDefault();
        addImages(e.dataTransfer.files);
      }}>
      {images.length > 0 && attaching && (
        <PendingImages items={images} compress={compress} status={status} onRemove={removeImage}
          onCompress={(on) => {
            setCompress(on);
            rememberCompress(on);
          }} />
      )}
      {editing && (
        <div className="chat-editing">
          <span>Изменение сообщения</span>
          <button type="button" className="btn btn-small" onClick={() => {
            setText('');
            onCancelEdit();
          }}>Отмена</button>
        </div>
      )}
      <div className="chat-composer-row">
        {attaching && (
          <>
            <button type="button" className="chat-attach" disabled={disabled || busy || images.length >= MAX_IMAGES}
              onClick={() => picker.current?.click()} aria-label="Прикрепить изображение" title="Прикрепить изображение">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input ref={picker} type="file" accept="image/*" multiple hidden
              onChange={(e) => {
                addImages(e.target.files);
                e.target.value = '';
              }} />
          </>
        )}
        <textarea ref={input} rows={1} value={text} placeholder={placeholder} maxLength={4000}
          disabled={disabled} aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (attaching && e.clipboardData.files.length && addImages(e.clipboardData.files)) {
              e.preventDefault();
              return;
            }
            const next = pasteAsLink(e.currentTarget, e.clipboardData.getData('text/plain'));
            if (!next) return;
            e.preventDefault();
            caret.current = next.caret;
            setText(next.value);
          }}
          onContextMenu={linkMenu.onContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && editing) {
              e.stopPropagation();
              setText('');
              onCancelEdit();
            }
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || coarsePointer()) return;
            e.preventDefault();
            submit();
          }} />
        {linkMenu.menu}
        <button type="button" className="btn btn-primary chat-send"
          disabled={disabled || busy || (!text.trim() && !(attaching && images.length) && !(editing && editing.images?.length))}
          onClick={submit} aria-label={editing ? 'Сохранить' : 'Отправить'} title={editing ? 'Сохранить' : 'Отправить'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {editing ? <path d="M20 6 9 17l-5-5" /> : <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>}
          </svg>
        </button>
      </div>
    </div>
  );
}

/** The message's pictures in its bubble; `onOpen(index)` shows one large. */
function MessageImages({ images, onOpen }) {
  const one = images.length === 1;
  return (
    <div className={`chat-images ${one ? 'chat-images-one' : ''}`}>
      {images.map((image, i) => (
        <button key={image.id} type="button" className="chat-image"
          style={one ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(i);
          }}
          aria-label={`Открыть изображение ${image.name}`}>
          <img src={chatImageUrl(shownId(image))} alt="" loading="lazy" width={image.width} height={image.height} />
          {image.original && <span className="chat-image-badge">Оригинал</span>}
        </button>
      ))}
    </div>
  );
}

/** One of the message's pictures over the whole screen, with the others a swipe or arrow away. */
function ImageViewer({ images, index: start, onClose }) {
  const [index, setIndex] = useState(start);
  const image = images[index];
  const many = images.length > 1;
  const go = (step) => setIndex((i) => (i + step + images.length) % images.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Only the viewer closes, not the chat under it.
        e.stopImmediatePropagation();
        onClose();
      }
      if (many && e.key === 'ArrowLeft') go(-1);
      if (many && e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Originals the browser can't show (e.g. HEIC) are shown by their preview and can be downloaded.
  const src = chatImageUrl(image.original && !isImage(image) ? shownId(image) : image.id);
  return createPortal(
    <div className="image-viewer" role="dialog" aria-label={image.name} onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="image-viewer-bar">
        <span className="image-viewer-info">
          {many && `${index + 1} из ${images.length} · `}
          {image.original ? `Оригинал · ${formatSize(image.size)}` : `Сжато · ${formatSize(image.size)}`}
          {` · ${image.width}×${image.height}`}
        </span>
        <a className="btn btn-small" href={chatImageUrl(image.id, { download: true })} download={image.name}>Скачать</a>
        <button type="button" className="btn btn-small" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      <img key={image.id} className="image-viewer-img" src={src} alt=""
        onMouseDown={(e) => e.stopPropagation()} />
      {many && (
        <>
          <button type="button" className="image-viewer-nav image-viewer-prev" onClick={() => go(-1)} aria-label="Предыдущее">‹</button>
          <button type="button" className="image-viewer-nav image-viewer-next" onClick={() => go(1)} aria-label="Следующее">›</button>
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * Messages as a chat. `messages`: [{ id, authorId, authorName, authorPicture, text, createdAt, editedAt,
 * pending }] oldest first; the user's own (`me`) are on the right. Without `onSend` there is no input;
 * `hint` explains why sending is off (`disabled`). `canDelete(message)` defaults to the user's own.
 * Messages with `event` are notes of changes; their card opens with `onOpenCard(id)`. `direct`: a chat of
 * two, without the other person's avatar and name at their messages.
 */
export default function ChatThread({
  messages, me, onSend, onEdit, onDelete, canDelete, onOpenCard, disabled, hint, placeholder = 'Сообщение', empty,
  className = '', direct = false, canAttach = true,
}) {
  const list = useRef(null);
  const atBottom = useRef(true);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const cardNumbers = useCardNumbers();
  const lastId = messages[messages.length - 1]?.id;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, messages.length]);

  const mayDelete = (m) => (canDelete ? canDelete(m) : m.authorId === me);

  return (
    <div className={`chat ${className}`}>
      <div className="chat-messages" ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}>
        {messages.length === 0 && empty && <p className="chat-empty muted">{empty}</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const event = m.event && parseEvent(m.event);
          if (event) {
            return (
              <Fragment key={m.id}>
                {newDay && <div className="chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
                <div className="chat-event">
                  <Avatar user={{ name: m.authorName, picture: m.authorPicture }} size={18} />
                  <span className="chat-event-text">
                    {m.authorName && <span className="chat-event-author">{m.authorName}: </span>}
                    <EventText event={event} numbers={cardNumbers} onOpenCard={onOpenCard} />
                    <EventDiff diff={event.diff} />
                  </span>
                  <span className="chat-time" title={new Date(m.createdAt).toLocaleString('ru-RU')}>{time(m.createdAt)}</span>
                </div>
              </Fragment>
            );
          }
          const grouped = continues(prev, m);
          const last = !continues(m, messages[i + 1]);
          const mine = m.authorId === me;
          const withAuthor = !mine && !direct;
          const actions = selected === m.id && (mine && onEdit || mayDelete(m) && onDelete);
          const name = m.authorName || 'Без имени';
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
              <div className={`chat-msg ${mine ? 'chat-msg-mine' : ''} ${grouped ? 'chat-msg-grouped' : ''} ${last ? 'chat-msg-tail' : ''}`}>
                {withAuthor && (last
                  ? <Avatar user={{ name: m.authorName, picture: m.authorPicture }} size={34} />
                  : <span className="chat-avatar-space" />)}
                <div className="chat-bubble-wrap">
                  <div className={`chat-bubble ${m.pending ? 'chat-bubble-pending' : ''}`}
                    onClick={(e) => {
                      if (e.target.closest('a')) return;
                      setSelected(selected === m.id ? null : m.id);
                    }}>
                    {withAuthor && !grouped && (
                      <div className="chat-author" style={{ '--author-hue': nameHue(m.authorName || '') }}>{name}</div>
                    )}
                    {m.images?.length > 0 && (
                      <MessageImages images={m.images} onOpen={(index) => setViewing({ images: m.images, index })} />
                    )}
                    {m.text && <div className="chat-text"><Markdown text={m.text} /></div>}
                    <span className="chat-time" title={new Date(m.createdAt).toLocaleString('ru-RU')}>
                      {m.editedAt ? 'изм. ' : ''}{time(m.createdAt)}
                      {mine && <Ticks pending={m.pending} />}
                    </span>
                  </div>
                  {actions && (
                    <div className="chat-actions">
                      {mine && onEdit && (
                        <button type="button" className="btn btn-small" onClick={() => {
                          setEditing(m);
                          setSelected(null);
                        }}>Изменить</button>
                      )}
                      {mayDelete(m) && onDelete && (
                        <button type="button" className="btn btn-small btn-danger" onClick={async () => {
                          if (!confirm('Удалить сообщение?')) return;
                          setSelected(null);
                          try {
                            await onDelete(m);
                          } catch (err) {
                            alert(err.message);
                          }
                        }}>Удалить</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {hint && <p className="chat-hint muted">{hint}</p>}
      {onSend && (
        <Composer editing={editing} disabled={disabled} placeholder={placeholder} canAttach={canAttach}
          onCancelEdit={() => setEditing(null)}
          onSubmit={async (text, images) => {
            atBottom.current = true;
            if (editing) {
              await onEdit(editing, text);
              setEditing(null);
            } else {
              await onSend(text, images);
            }
          }} />
      )}
      {viewing && <ImageViewer images={viewing.images} index={viewing.index} onClose={() => setViewing(null)} />}
    </div>
  );
}

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EventDiff, EventText, parseEvent, useCardNumbers } from '../chatEvents.jsx';
import {
  chatImageUrl, compressByDefault, isImageFile, rememberCompress, shownId, uploadChatImage,
} from '../chatImages.js';
import { formatSize, isImage } from '../files.js';
import { pasteAsLink } from '../links.js';
import { ICONS } from '../menuIcons.js';
import ContextMenu from './ContextMenu.jsx';
import Modal from './Modal.jsx';
import Avatar from './Avatar.jsx';
import { useLinkMenu } from './LinkMenu.jsx';
import Markdown from './Markdown.jsx';

// Phones put a line break on Enter; elsewhere Enter sends and Shift+Enter breaks the line.
const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches;
const GROUP_MS = 5 * 60 * 1000;
// As the server's limit of a reply's text (reply.js).
const MAX_REPLY_TEXT = 1000;

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

/** As in Telegram: a clock until the server has the message, one tick — delivered, two — read. */
function Ticks({ pending, read }) {
  if (pending) {
    return (
      <svg className="chat-ticks" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.25" strokeLinecap="round" aria-label="Не отправлено"><title>Отправляется</title>
        <circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>
    );
  }
  return (
    <svg className={`chat-ticks ${read ? 'chat-ticks-read' : ''}`} width="19" height="14" viewBox="0 0 28 20" fill="none"
      stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
      aria-label={read ? 'Просмотрено' : 'Доставлено'}>
      <title>{read ? 'Просмотрено' : 'Доставлено'}</title>
      {read ? <><path d="m2 11 5 5L18 5" /><path d="m13 15 1 1L25 5" /></> : <path d="m4 11 5 5L20 5" />}
    </svg>
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

/** A short line of the message for the editing bar and the delete dialog. */
function snippet(m) {
  const text = (m.text ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  const count = m.images?.length ?? 0;
  return count > 1 ? `Фото: ${count}` : count ? 'Фото' : '';
}

function Composer({
  editing, replying, onSubmit, onCancelEdit, onCancelReply, onEditLast, placeholder, disabled, canAttach,
}) {
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

  // What was typed before editing comes back once the editing is over.
  const draft = useRef(null);
  useEffect(() => {
    if (editing) {
      draft.current ??= text;
      setText(editing.text);
      input.current?.focus();
    } else if (draft.current != null) {
      setText(draft.current);
      draft.current = null;
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (replying) input.current?.focus();
  }, [replying]);

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
      // After an edit the draft from before it comes back (see above).
      if (!editing) setText('');
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
          <svg className="chat-editing-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS.rename} /></svg>
          <span className="chat-editing-text">
            <span className="chat-editing-title">Редактирование</span>
            <span className="chat-editing-snippet">{snippet(editing)}</span>
          </span>
          <button type="button" className="chat-editing-cancel" onClick={onCancelEdit}
            aria-label="Отменить редактирование" title="Отменить редактирование (Esc)">×</button>
        </div>
      )}
      {replying && !editing && (
        <div className="chat-editing">
          <svg className="chat-editing-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={replying.quote ? ICONS.quote : ICONS.reply} />
          </svg>
          <span className="chat-editing-text">
            <span className="chat-editing-title">{replying.quote ? 'Цитата' : 'Ответ'}: {replying.author}</span>
            <span className="chat-editing-snippet">{snippet(replying)}</span>
          </span>
          <button type="button" className="chat-editing-cancel" onClick={onCancelReply}
            aria-label="Отменить ответ" title="Отменить ответ (Esc)">×</button>
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
            if (e.key === 'Escape' && (editing || replying)) {
              e.stopPropagation();
              if (editing) onCancelEdit();
              else onCancelReply();
            }
            // As in Telegram: ↑ in an empty field edits the last own message.
            if (e.key === 'ArrowUp' && !text && !editing && images.length === 0 && onEditLast?.()) {
              e.preventDefault();
              return;
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
 * Text selected within one message of the list `ref`: { id, text, x, top, bottom } (the middle and the
 * edges of the selection on the screen), or null.
 */
function useQuoteSelection(ref) {
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      const node = range?.commonAncestorContainer;
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const text = sel?.toString().trim();
      const message = el?.closest('.chat-text') && el.closest('[data-message]');
      if (!text || !message || !ref.current?.contains(message)) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelection({
        id: message.dataset.message, text: text.slice(0, MAX_REPLY_TEXT), x: rect.left + rect.width / 2, top: rect.top,
        bottom: rect.bottom,
      });
    };
    const list = ref.current;
    document.addEventListener('selectionchange', update);
    list?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      list?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ref]);
  return selection;
}

/** «Удалить сообщение?» — it goes for everyone in the chat. */
function DeleteMessageDialog({ message, direct, onDelete, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const text = snippet(message);
  return createPortal(
    <Modal title="Удалить сообщение?" onClose={onClose} className="confirm-delete delete-message-dialog">
      {text && <p className="delete-message-snippet">{text}</p>}
      <p className="muted account-hint">
        {direct ? 'Сообщение удалится и у вас, и у собеседника.' : 'Сообщение удалится у всех участников чата.'}
      </p>
      {error && <p className="login-error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onDelete();
          } catch (err) {
            setError(err.message);
            setBusy(false);
          }
        }}>{busy ? 'Удаляем…' : 'Удалить'}</button>
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * Messages as a chat. `messages`: [{ id, authorId, authorName, authorPicture, text, createdAt, editedAt,
 * pending }] oldest first; the user's own (`me`) are on the right. Without `onSend` there is no input;
 * `hint` explains why sending is off (`disabled`). `canDelete(message)` defaults to the user's own.
 * Messages with `event` are notes of changes; their card opens with `onOpenCard(id)`. `direct`: a chat of
 * two, without the other person's avatar and name at their messages. `readAt`: until when the others have
 * read the chat — the user's messages from before it get two ticks.
 */
export default function ChatThread({
  messages, me, onSend, onEdit, onDelete, canDelete, onOpenCard, disabled, hint, placeholder = 'Сообщение', empty,
  className = '', direct = false, canAttach = true, readAt = 0,
}) {
  const list = useRef(null);
  const atBottom = useRef(true);
  // The message's menu: { x, y, message }.
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  // The answered message: { id, author, text, quote } (as saved in the reply's `reply`).
  const [replying, setReplying] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewing, setViewing] = useState(null);
  // The message briefly highlighted after a click on a reply to it.
  const [flash, setFlash] = useState(null);
  const selection = useQuoteSelection(list);
  const cardNumbers = useCardNumbers();
  const lastId = messages[messages.length - 1]?.id;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, messages.length]);

  // An edited message disappears (deleted elsewhere): nothing left to edit.
  useEffect(() => {
    if (editing && !messages.some((m) => m.id === editing.id)) setEditing(null);
  }, [messages, editing]);

  const mayDelete = (m) => (canDelete ? canDelete(m) : m.authorId === me);
  const mayEdit = (m) => Boolean(onEdit) && m.authorId === me && !m.event;
  const mayReply = Boolean(onSend) && !disabled;
  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});
  const edit = (m) => {
    setReplying(null);
    setEditing(m);
  };
  /** Answers `m`; with `quote` (the selected part of its text) — quoting it. */
  const reply = (m, quote = '') => {
    setEditing(null);
    setReplying({
      id: m.id,
      author: (m.authorName || 'Без имени').slice(0, 200),
      text: (quote || m.text?.trim() || snippet(m)).slice(0, MAX_REPLY_TEXT),
      quote: Boolean(quote),
    });
    window.getSelection()?.removeAllRanges();
  };
  // With a part of the message's text selected the menu is about that part.
  const menuItems = (m, quote) => (quote ? [
    mayReply && { label: 'Ответить с цитатой', icon: ICONS.quote, run: () => reply(m, quote) },
    { label: 'Копировать выделенное', icon: ICONS.copy, run: () => copy(quote) },
  ] : [
    mayReply && { label: 'Ответить', icon: ICONS.reply, run: () => reply(m) },
    mayEdit(m) && { label: 'Изменить', icon: ICONS.rename, run: () => edit(m) },
    m.text && { label: 'Копировать текст', icon: ICONS.copy, run: () => copy(m.text) },
    mayDelete(m) && onDelete && { label: 'Удалить', icon: ICONS.trash, danger: true, run: () => setDeleting(m) },
  ]).filter(Boolean);
  const openMenu = (e, m) => {
    if (e.target.closest('a, .chat-image, .chat-reply')) return;
    const quote = selection?.id === m.id ? selection.text : '';
    // A selection elsewhere keeps the browser's own menu (to copy it).
    if (!quote && window.getSelection()?.toString()) return;
    const items = menuItems(m, quote);
    if (!items.length) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, message: m, quote });
  };
  const editLast = () => {
    const own = [...messages].reverse().find(mayEdit);
    if (own) edit(own);
    return Boolean(own);
  };
  const jumpTo = (id) => {
    const el = list.current?.querySelector(`[data-message="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id);
  };
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [flash]);
  const selected = selection && mayReply && messages.find((m) => m.id === selection.id);

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
          const name = m.authorName || 'Без имени';
          const active = menu?.message.id === m.id || editing?.id === m.id || deleting?.id === m.id || replying?.id === m.id;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
              <div className={`chat-msg ${mine ? 'chat-msg-mine' : ''} ${grouped ? 'chat-msg-grouped' : ''} ${last ? 'chat-msg-tail' : ''}
                ${active ? 'chat-msg-active' : ''} ${flash === m.id ? 'chat-msg-flash' : ''}`} data-message={m.id}>
                {withAuthor && (last
                  ? <Avatar user={{ name: m.authorName, picture: m.authorPicture }} size={34} />
                  : <span className="chat-avatar-space" />)}
                <div className="chat-bubble-wrap">
                  {/* As in Telegram: a right click (or a tap on a phone) opens the message's menu. */}
                  <div className={`chat-bubble ${m.pending ? 'chat-bubble-pending' : ''}`}
                    onContextMenu={(e) => openMenu(e, m)}
                    onClick={(e) => coarsePointer() && openMenu(e, m)}>
                    {withAuthor && !grouped && (
                      <div className="chat-author" style={{ '--author-hue': nameHue(m.authorName || '') }}>{name}</div>
                    )}
                    {m.reply && (
                      <button type="button" className={`chat-reply ${m.reply.quote ? 'chat-reply-quote' : ''}`}
                        style={{ '--author-hue': nameHue(m.reply.author) }} onClick={() => jumpTo(m.reply.id)}
                        title="Показать сообщение">
                        <span className="chat-reply-author">{m.reply.author || 'Без имени'}</span>
                        <span className="chat-reply-text">{m.reply.text}</span>
                      </button>
                    )}
                    {m.images?.length > 0 && (
                      <MessageImages images={m.images} onOpen={(index) => setViewing({ images: m.images, index })} />
                    )}
                    {m.text && <div className="chat-text"><Markdown text={m.text} /></div>}
                    <span className="chat-time" title={new Date(m.createdAt).toLocaleString('ru-RU')}>
                      {m.editedAt ? <span title={`Изменено ${new Date(m.editedAt).toLocaleString('ru-RU')}`}>изменено </span> : ''}
                      {time(m.createdAt)}
                      {mine && <Ticks pending={m.pending} read={m.createdAt <= readAt} />}
                    </span>
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {hint && <p className="chat-hint muted">{hint}</p>}
      {onSend && (
        <Composer editing={editing} replying={replying} disabled={disabled} placeholder={placeholder} canAttach={canAttach}
          onCancelEdit={() => setEditing(null)} onCancelReply={() => setReplying(null)} onEditLast={onEdit ? editLast : null}
          onSubmit={async (text, images) => {
            if (editing) {
              if (text !== editing.text.trim()) await onEdit(editing, text);
              setEditing(null);
            } else {
              atBottom.current = true;
              await onSend(text, images, replying);
              setReplying(null);
            }
          }} />
      )}
      {selected && !menu && createPortal(
        <button type="button" className={`chat-quote-button ${coarsePointer() ? 'chat-quote-button-below' : ''}`}
          style={{ left: selection.x, top: coarsePointer() ? selection.bottom : selection.top }}
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
          onClick={() => reply(selected, selection.text)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS.quote} /></svg>
          Цитировать
        </button>,
        document.body,
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.message, menu.quote)} onClose={() => setMenu(null)} />
      )}
      {deleting && (
        <DeleteMessageDialog message={deleting} direct={direct} onClose={() => setDeleting(null)}
          onDelete={async () => {
            await onDelete(deleting);
            if (editing?.id === deleting.id) setEditing(null);
            setDeleting(null);
          }} />
      )}
      {viewing && <ImageViewer images={viewing.images} index={viewing.index} onClose={() => setViewing(null)} />}
    </div>
  );
}

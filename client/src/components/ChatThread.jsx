import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EventDiff, EventText, parseEvent, useCardNumbers } from '../chatEvents.jsx';
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

function Composer({ editing, onSubmit, onCancelEdit, placeholder, disabled }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
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
    if (!value || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit(value);
      setText('');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className="chat-composer">
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
        <textarea ref={input} rows={1} value={text} placeholder={placeholder} maxLength={4000}
          disabled={disabled} aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
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
        <button type="button" className="btn btn-primary chat-send" disabled={disabled || busy || !text.trim()}
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

/**
 * Messages as a chat. `messages`: [{ id, authorId, authorName, authorPicture, text, createdAt, editedAt,
 * pending }] oldest first; the user's own (`me`) are on the right. Without `onSend` there is no input;
 * `hint` explains why sending is off (`disabled`). `canDelete(message)` defaults to the user's own.
 * Messages with `event` are notes of changes; their card opens with `onOpenCard(id)`. `direct`: a chat of
 * two, without the other person's avatar and name at their messages.
 */
export default function ChatThread({
  messages, me, onSend, onEdit, onDelete, canDelete, onOpenCard, disabled, hint, placeholder = 'Сообщение', empty,
  className = '', direct = false,
}) {
  const list = useRef(null);
  const atBottom = useRef(true);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
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
                    <div className="chat-text"><Markdown text={m.text} /></div>
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
        <Composer editing={editing} disabled={disabled} placeholder={placeholder}
          onCancelEdit={() => setEditing(null)}
          onSubmit={async (text) => {
            atBottom.current = true;
            if (editing) {
              await onEdit(editing, text);
              setEditing(null);
            } else {
              await onSend(text);
            }
          }} />
      )}
    </div>
  );
}

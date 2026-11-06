import { useRef, useSyncExternalStore } from 'react';
import { cardColor } from '../appearance.js';
import { uploadStore } from '../files.js';
import { cardReminders, nextReminder } from '../reminders.js';
import { splitTags, tagKey } from '../tags.js';
import CardMenu from './CardMenu.jsx';
import Markdown from './Markdown.jsx';

function formatReminder(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `сегодня ${time}`;
  if (days === 1) return `завтра ${time}`;
  const date = d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
  return `${date} ${time}`;
}

export function ReminderBadge({ card }) {
  const next = nextReminder(card, Date.now());
  if (!next) return null;
  const count = cardReminders(card).length;
  return (
    <span className={`card-reminder${next.past ? ' card-reminder-past' : ''}`}
      title={count > 1 ? `Напоминаний: ${count}` : 'Напоминание'}>
      <BellIcon />
      {formatReminder(next.time)}
      {next.repeat && ' ↻'}
      {count > 1 && <span className="card-reminder-more">+{count - 1}</span>}
    </span>
  );
}

function BellIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

/** Done of all subtasks, if the card has any. */
export function ChecklistBadge({ card }) {
  const items = card.checklist ?? [];
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  return (
    <span className={`card-checklist${done === items.length ? ' card-checklist-done' : ''}`}
      title={`Подзадачи: выполнено ${done} из ${items.length}`}>
      <CheckIcon />
      {done}/{items.length}
    </span>
  );
}

export function ClipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function CommentIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Files still uploading to the card (they continue after the editor is closed). */
function UploadBadge({ cardId }) {
  const uploads = useSyncExternalStore(uploadStore.subscribe, uploadStore.get).filter((u) => u.cardId === cardId);
  if (!uploads.length) return null;
  if (uploads.some((u) => u.error)) {
    return <span className="badge badge-conflict" title="Откройте карточку, чтобы посмотреть">Файл не загружен</span>;
  }
  const progress = uploads.reduce((sum, u) => sum + u.progress, 0) / uploads.length;
  return (
    <span className="card-uploading" title={uploads.map((u) => u.name).join(', ')}>
      <ClipIcon />
      Загрузка {uploads.length > 1 ? `${uploads.length} файлов ` : ''}{Math.round(progress * 100)}%
    </span>
  );
}

/**
 * Text with Markdown and its #tags as buttons that toggle the tag filter; `activeTags` are the
 * filtered tag keys. `inline`: one line (the title).
 */
function TaggedText({ text, inline, activeTags, onTag }) {
  return (
    <Markdown text={text} inline={inline}
      renderText={(part) => <Tags text={part} activeTags={activeTags} onTag={onTag} />} />
  );
}

function Tags({ text, activeTags, onTag }) {
  return splitTags(text).map((part, i) => {
    if (typeof part === 'string') return part;
    const active = activeTags.has(tagKey(part.tag));
    return (
      <button key={i} type="button" className={`tag ${active ? 'tag-active' : ''}`}
        title={active ? 'Убрать из фильтра' : 'Показать карточки с этим тегом'}
        onClick={(e) => {
          e.stopPropagation();
          onTag(part.tag);
        }}>
        #{part.tag}
      </button>
    );
  });
}

/** Id and height of the card being dragged: `dataTransfer` can't be read until the drop. */
export let draggedCardId = null;
export let draggedCardHeight = 0;
export function setDraggedCard(id, height = draggedCardHeight) {
  draggedCardId = id;
  draggedCardHeight = height;
}

export default function Card({
  card, label, activeTags, onTag, readOnly, onOpen, onOpenLabel, prevColumn, nextColumn,
}) {
  const ref = useRef(null);
  const classes = ['card'];
  if (card.conflict) classes.push('card-conflict');
  if (card.deleted) classes.push('card-deleted');

  return (
    <article
      ref={ref}
      className={classes.join(' ')}
      data-card-id={card.id}
      draggable={!card.conflict && !readOnly}
      onDragStart={(e) => {
        draggedCardId = card.id;
        draggedCardHeight = e.currentTarget.offsetHeight;
        e.dataTransfer.setData('text/card-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        draggedCardId = null;
      }}
      onClick={onOpen}
    >
      {cardColor(card) && <div className="card-cover" style={{ background: cardColor(card) }} />}
      {label && (
        <button className="card-label" title="Открыть" onClick={(e) => {
          e.stopPropagation();
          onOpenLabel();
        }}>
          {label}
        </button>
      )}
      <div className="card-title">
        {card.title
          ? <TaggedText text={card.title} inline activeTags={activeTags} onTag={onTag} />
          : <em className="muted">Без названия</em>}
      </div>
      {card.description && (
        <div className="card-desc"><TaggedText text={card.description} activeTags={activeTags} onTag={onTag} /></div>
      )}
      <div className="card-footer">
        <div className="card-badges">
          {card.number && <span className="card-number" title="Номер карточки">#{card.number}</span>}
          <ReminderBadge card={card} />
          <ChecklistBadge card={card} />
          <UploadBadge cardId={card.id} />
          {card.attachments?.length > 0 && (
            <span className="card-files" title="Прикреплённые файлы">
              <ClipIcon />
              {card.attachments.length}
            </span>
          )}
          {card.comments && (
            <span className={`card-comments${card.comments.unread ? ' card-comments-unread' : ''}`}
              title={card.comments.unread ? `Новых комментариев: ${card.comments.unread}` : 'Комментарии'}>
              <CommentIcon />
              {card.comments.count}
            </span>
          )}
          {card.conflict && <span className="badge badge-conflict">Конфликт — нажмите, чтобы решить</span>}
          {!card.conflict && card.dirty === 1 && <span className="badge badge-pending">Не синхр.</span>}
        </div>
        {!card.conflict && (
          <div className="card-moves" onClick={(e) => e.stopPropagation()}>
            <CardMenu card={card} prevColumn={prevColumn} nextColumn={nextColumn} readOnly={readOnly}
              onOpen={onOpen} hoverRef={ref} />
          </div>
        )}
      </div>
    </article>
  );
}

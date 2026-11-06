import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createInboxCard, deleteCard, moveCardTo } from '../actions.js';
import { db, INBOX_ID } from '../db.js';
import { ChecklistBadge, ClipIcon, ReminderBadge, setDraggedCard } from './Card.jsx';
import { FolderPickerDialog } from './FolderSelect.jsx';
import Markdown from './Markdown.jsx';

const svg = (children) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

/** A tray: what lands in «Входящие». */
export function InboxIcon() {
  return svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></>);
}
const MoveIcon = () => svg(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>);
const DeleteIcon = () => svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>);
const CloseIcon = () => svg(<path d="M18 6 6 18M6 6l12 12" />);

/** What the card holds besides its title, as on the board; nothing when it holds nothing. */
function InboxBadges({ card }) {
  const files = card.attachments?.length ?? 0;
  if (!card.remindAt && !card.reminders?.length && !card.checklist?.length && !files) return null;
  return (
    <div className="card-badges inbox-card-badges">
      <ReminderBadge card={card} />
      <ChecklistBadge card={card} />
      {files > 0 && <span className="card-files" title="Прикреплённые файлы"><ClipIcon />{files}</span>}
    </div>
  );
}

/** The live cards in «Входящие», in their order. */
export function useInboxCards() {
  return useLiveQuery(
    async () => (await db.cards.where('folderId').equals(INBOX_ID).toArray())
      .filter((c) => !c.deleted)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    [],
  );
}

/**
 * «Входящие»: cards dumped quickly, to be sorted out onto `folders` later — dragged to a column of the board
 * (the panel doesn't cover it) or moved with «На доску». `onOpen(id)` opens a card.
 */
export default function InboxPanel({ folders, onOpen, onClose }) {
  const cards = useInboxCards() ?? [];
  const [title, setTitle] = useState('');
  const [moving, setMoving] = useState(null);
  // A card of the board dragged over the panel: it goes back to «Входящие» on the drop.
  const [dropping, setDropping] = useState(false);
  const fromBoard = (e) => e.dataTransfer.types.includes('text/card-id') && !e.dataTransfer.types.includes('text/inbox');

  function add(e) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    createInboxCard(value);
    setTitle('');
  }

  return (
    <aside className={`inbox ${dropping ? 'inbox-drop' : ''}`} aria-label="Входящие"
      onDragOver={(e) => {
        if (!fromBoard(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        if (!fromBoard(e)) return;
        e.preventDefault();
        moveCardTo(e.dataTransfer.getData('text/card-id'), INBOX_ID);
      }}>
      <div className="inbox-head">
        <h2 className="inbox-title"><InboxIcon /> Входящие</h2>
        <button type="button" className="inbox-head-btn" title="Закрыть" aria-label="Закрыть" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <form className="inbox-add" onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="+ Добавить карточку"
          aria-label="Новое дело" maxLength={500} />
      </form>
      {cards.length ? (
        <ul className="inbox-list">
          {cards.map((card) => (
            <li key={card.id} className="inbox-card" draggable
              onDragStart={(e) => {
                setDraggedCard(card.id, e.currentTarget.offsetHeight);
                e.dataTransfer.setData('text/card-id', card.id);
                e.dataTransfer.setData('text/inbox', '1');
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDraggedCard(null)}>
              <button type="button" className="inbox-card-title" onClick={() => onOpen(card.id)}>
                {card.title ? <Markdown text={card.title} inline /> : <em className="muted">Без названия</em>}
              </button>
              <InboxBadges card={card} />
              <span className="inbox-card-actions">
                <button type="button" className="btn btn-small btn-icon-only" title="На доску…" aria-label="На доску"
                  disabled={!folders.length} onClick={() => setMoving(card.id)}>
                  <MoveIcon />
                </button>
                <button type="button" className="btn btn-small btn-icon-only" title="Удалить" aria-label="Удалить"
                  onClick={() => confirm('Удалить карточку?') && deleteCard(card.id)}>
                  <DeleteIcon />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="inbox-empty">
          <span className="inbox-empty-icon"><InboxIcon /></span>
          <strong>Все дела в одном месте</strong>
          <p>
            Записывайте сюда дела, не думая, куда их деть. Потом перетащите каждое в колонку доски
            или перенесите кнопкой «На доску». Карточку с доски можно вернуть сюда перетаскиванием
            или пунктом «Во „Входящие“» в её меню.
          </p>
        </div>
      )}
      {moving && createPortal(
        <FolderPickerDialog title="На доску" folders={folders} value={null}
          onPick={(folderId) => moveCardTo(moving, folderId)} onClose={() => setMoving(null)} />,
        document.body,
      )}
    </aside>
  );
}

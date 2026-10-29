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

function BellIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** Id of the card being dragged: `dataTransfer` can't be read until the drop. */
export let draggedCardId = null;

/** `dropMark` ('before' | 'after' | null) shows where a dragged card would be inserted. */
export default function Card({ card, label, dropMark, onOpen, onOpenLabel, onMoveLeft, onMoveRight }) {
  const classes = ['card'];
  if (dropMark) classes.push(`card-drop-${dropMark}`);
  if (card.conflict) classes.push('card-conflict');
  if (card.deleted) classes.push('card-deleted');

  return (
    <article
      className={classes.join(' ')}
      data-card-id={card.id}
      draggable={!card.conflict}
      onDragStart={(e) => {
        draggedCardId = card.id;
        e.dataTransfer.setData('text/card-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        draggedCardId = null;
      }}
      onClick={onOpen}
    >
      {label && (
        <button className="card-label" title="Открыть" onClick={(e) => {
          e.stopPropagation();
          onOpenLabel();
        }}>
          {label}
        </button>
      )}
      <div className="card-title">{card.title || <em className="muted">Без названия</em>}</div>
      {card.description && <div className="card-desc">{card.description}</div>}
      <div className="card-footer">
        <div className="card-badges">
          {card.remindAt && (
            <span className={`card-reminder${card.remindAt <= Date.now() ? ' card-reminder-past' : ''}`}
              title="Напоминание">
              <BellIcon />
              {formatReminder(card.remindAt)}
            </span>
          )}
          {card.conflict && <span className="badge badge-conflict">Конфликт — нажмите, чтобы решить</span>}
          {!card.conflict && card.dirty === 1 && <span className="badge badge-pending">Не синхр.</span>}
        </div>
        {!card.conflict && (
          <div className="card-moves" onClick={(e) => e.stopPropagation()}>
            {onMoveLeft && <button className="btn btn-icon" title="Влево" onClick={onMoveLeft}>←</button>}
            {onMoveRight && <button className="btn btn-icon" title="Вправо" onClick={onMoveRight}>→</button>}
          </div>
        )}
      </div>
    </article>
  );
}

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

export default function Card({ card, label, onOpen, onOpenLabel, onDrop }) {
  const classes = ['card'];
  if (card.conflict) classes.push('card-conflict');
  if (card.deleted) classes.push('card-deleted');

  return (
    <article
      className={classes.join(' ')}
      draggable={!card.conflict}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/card-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
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
      {(card.remindAt || card.conflict || card.dirty === 1) && (
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
      )}
    </article>
  );
}

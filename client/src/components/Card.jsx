export default function Card({ card, label, onOpen, onOpenLabel, onDrop, onMoveLeft, onMoveRight }) {
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
      <div className="card-footer">
        <div className="card-badges">
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

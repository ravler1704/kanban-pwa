import { useEffect, useRef, useState } from 'react';
import { createCard, moveCard, moveCardToEnd } from '../actions.js';
import Card, { draggedCardId } from './Card.jsx';

function positionBefore(cards, targetId) {
  const index = cards.findIndex((c) => c.id === targetId);
  const target = cards[index];
  const prev = cards[index - 1];
  return prev ? (prev.position + target.position) / 2 : target.position - 1;
}

function positionAtEnd(cards) {
  return cards.length ? cards[cards.length - 1].position + 1 : 1;
}

/**
 * `target` ({ projectId, sectionId }) is where new cards go.
 * `cardLabel(card)` returns the project/section shown on the card, or null for none.
 */
export default function Column({
  target, column, prevColumn, nextColumn, cards, cardLabel, activeTags, onTag, readOnly, onOpen, onOpenGroup,
}) {
  const [title, setTitle] = useState('');
  // While a card is dragged over the column: the id of the card it would land before, or null for the end.
  const [dropBefore, setDropBefore] = useState(undefined);
  const list = useRef(null);
  const dragOver = dropBefore !== undefined;

  useEffect(() => {
    const reset = () => setDropBefore(undefined);
    window.addEventListener('dragend', reset);
    return () => window.removeEventListener('dragend', reset);
  }, []);

  function handleDragOver(e) {
    e.preventDefault();
    const target = [...list.current.querySelectorAll(':scope > .card')].find((el) => {
      const rect = el.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    setDropBefore(target?.dataset.cardId ?? null);
  }

  function handleDrop(e) {
    e.preventDefault();
    const beforeId = dropBefore ?? null;
    setDropBefore(undefined);
    const id = e.dataTransfer.getData('text/card-id');
    if (!id || id === beforeId) return;

    const others = cards.filter((c) => c.id !== id);
    const position = beforeId ? positionBefore(others, beforeId) : positionAtEnd(others);
    moveCard(id, column.id, position);
  }

  // Dropping right before or after the dragged card itself wouldn't move it.
  const index = dropBefore ? cards.findIndex((c) => c.id === dropBefore) : cards.length;
  const showIndicator = dragOver && cards[index]?.id !== draggedCardId && cards[index - 1]?.id !== draggedCardId;
  const dropMark = (i) => {
    if (!showIndicator) return null;
    if (i === index) return 'before';
    if (i === cards.length - 1 && index === cards.length) return 'after';
    return null;
  };

  function handleAdd(e) {
    e.preventDefault();
    const value = title.trim();
    if (!value || !target) return;
    createCard(target, column.id, value);
    setTitle('');
  }

  return (
    <section
      className={`column ${dragOver ? 'column-dragover' : ''}`}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropBefore(undefined);
      }}
      onDrop={readOnly ? undefined : handleDrop}
    >
      <h2>
        {column.name} <span className="count">{cards.filter((c) => !c.deleted).length}</span>
      </h2>
      <div className="cards" ref={list}>
        {cards.map((card, i) => (
          <Card
            key={card.id}
            card={card}
            label={cardLabel?.(card)}
            dropMark={dropMark(i)}
            activeTags={activeTags}
            onTag={onTag}
            readOnly={readOnly}
            onOpen={() => onOpen(card.id)}
            onOpenLabel={() => onOpenGroup(card)}
            onMoveLeft={!readOnly && prevColumn && (() => moveCardToEnd(card.id, prevColumn.id))}
            onMoveRight={!readOnly && nextColumn && (() => moveCardToEnd(card.id, nextColumn.id))}
          />
        ))}
        {showIndicator && cards.length === 0 && <div className="drop-indicator" />}
      </div>
      {!readOnly && <form className="add-card" onSubmit={handleAdd}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="+ Новая карточка"
          maxLength={500}
        />
        {title.trim() && <button type="submit" className="btn btn-primary btn-small">Добавить</button>}
      </form>}
    </section>
  );
}

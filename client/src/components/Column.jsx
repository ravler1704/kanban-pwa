import { useState } from 'react';
import { createCard, moveCard } from '../actions.js';
import Card from './Card.jsx';

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
export default function Column({ target, column, cards, cardLabel, onOpen, onOpenGroup }) {
  const [title, setTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e, beforeId = null) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const id = e.dataTransfer.getData('text/card-id');
    if (!id || id === beforeId) return;

    const others = cards.filter((c) => c.id !== id);
    const position = beforeId ? positionBefore(others, beforeId) : positionAtEnd(others);
    moveCard(id, column.id, position);
  }

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
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <h2>
        {column.name} <span className="count">{cards.filter((c) => !c.deleted).length}</span>
      </h2>
      <div className="cards">
        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            label={cardLabel?.(card)}
            onOpen={() => onOpen(card.id)}
            onOpenLabel={() => onOpenGroup(card)}
            onDrop={(e) => handleDrop(e, card.id)}
          />
        ))}
      </div>
      <form className="add-card" onSubmit={handleAdd}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="+ Новая карточка"
          maxLength={500}
        />
        {title.trim() && <button type="submit" className="btn btn-primary btn-small">Добавить</button>}
      </form>
    </section>
  );
}

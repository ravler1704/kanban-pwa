import { useEffect, useRef, useState } from 'react';
import { createCard, moveCard, moveCardsToColumn, renameColumn } from '../actions.js';
import ColumnMenu from './ColumnMenu.jsx';
import EditableName from './EditableName.jsx';
import { PlusIcon } from './FolderBar.jsx';
import Card, { draggedCardHeight, draggedCardId } from './Card.jsx';

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
 * `target` (a folder id) is where new cards go; `targetName`, when set, is said in the add field.
 * `cardLabel(card)` returns the folder shown on the card, or null for none.
 * `edit` (see ColumnMenu), when set, lets the columns be changed from the column's menu.
 * `onNewCard()` opens the full new card form for the column.
 */
export default function Column({
  target, targetName, column, prevColumn, nextColumn, cards, cardLabel, activeTags, onTag, readOnly, onOpen, onOpenGroup,
  edit, onNewCard,
}) {
  const [title, setTitle] = useState('');
  // While a card is dragged over the column: the id of the card it would land before, or null for the end.
  const [dropBefore, setDropBefore] = useState(undefined);
  const list = useRef(null);
  const section = useRef(null);
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
  // An empty slot the size of the dragged card, where it would land.
  const slot = <div key="drop-slot" className="drop-slot" style={{ height: draggedCardHeight || undefined }} />;

  // Cards with an unresolved conflict wait for the user's choice and stay put.
  const movable = cards.filter((c) => !c.deleted && !c.conflict);

  function moveAll(to) {
    const what = movable.length === 1 ? '1 карточку' : `все карточки (${movable.length})`;
    if (!confirm(`Перенести ${what} из «${column.name}» в «${to.name}»?`)) return;
    moveCardsToColumn(movable.map((c) => c.id), to.id);
  }

  function handleAdd(e) {
    e.preventDefault();
    const value = title.trim();
    if (!value || !target) return;
    createCard({ folderId: target }, column.id, value);
    setTitle('');
  }

  return (
    <section
      ref={section}
      className={`column ${dragOver ? 'column-dragover' : ''}`}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropBefore(undefined);
      }}
      onDrop={readOnly ? undefined : handleDrop}
    >
      <div className="column-head">
        <h2>
          {edit
            ? <EditableName value={column.name} label="Название колонки" maxLength={100}
              note={edit.boards.length > 1
                ? `Набор «${edit.setName}» используют доски: ${edit.boards.map((b) => `«${b}»`).join(', ')}. Изменение применится ко всем.`
                : null}
              onSave={(name) => renameColumn(column.id, name)} />
            : column.name} <span className="count">{cards.filter((c) => !c.deleted).length}</span>
        </h2>
        {!readOnly && (
          <div className="column-moves">
            <ColumnMenu column={column} prevColumn={prevColumn} nextColumn={nextColumn}
              moveAll={movable.length ? moveAll : null} edit={edit} hoverRef={section} />
          </div>
        )}
      </div>
      <div className="cards" ref={list}>
        {cards.map((card, i) => [
          showIndicator && i === index && slot,
          <Card
            key={card.id}
            card={card}
            label={cardLabel?.(card)}
            activeTags={activeTags}
            onTag={onTag}
            readOnly={readOnly}
            onOpen={() => onOpen(card.id)}
            onOpenLabel={() => onOpenGroup(card)}
            prevColumn={prevColumn}
            nextColumn={nextColumn}
          />,
        ])}
        {showIndicator && index === cards.length && slot}
      </div>
      {!readOnly && <form className="add-card" onSubmit={handleAdd}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={targetName ? `+ Новая карточка в «${targetName}»` : '+ Новая карточка'}
          maxLength={500}
        />
        <button type={title.trim() ? 'submit' : 'button'} className={`btn btn-small btn-icon-only add-card-btn ${title.trim() ? 'btn-primary' : ''}`}
          title={title.trim() ? 'Добавить карточку' : 'Новая карточка: описание, напоминания, исполнитель'}
          aria-label={title.trim() ? 'Добавить карточку' : `Новая карточка в «${column.name}»`}
          onClick={title.trim() ? undefined : onNewCard}>
          <PlusIcon />
        </button>
      </form>}
    </section>
  );
}

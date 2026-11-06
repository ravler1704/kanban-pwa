import { useEffect, useRef, useState } from 'react';
import { createCard, moveCard, moveCardsToColumn, moveColumnTo, renameColumn } from '../actions.js';
import { columnColor } from '../appearance.js';
import ColumnMenu from './ColumnMenu.jsx';
import EditableName from './EditableName.jsx';
import { PlusIcon } from './FolderBar.jsx';
import Card, { draggedCardHeight, draggedCardId } from './Card.jsx';

/** The id of the column being dragged by its head: `dataTransfer` can't be read until the drop. */
let draggedColumnId = null;

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
 * `collapsed`: shown as a narrow strip with its name, `onToggleCollapsed()` switches it.
 * `onCollapseOthers()` expands this column and collapses the rest of the board, or expands them all when it's the only one left.
 */
export default function Column({
  target, targetName, column, prevColumn, nextColumn, cards, cardLabel, activeTags, onTag, readOnly, onOpen, onOpenGroup,
  edit, onNewCard, collapsed, onToggleCollapsed, onCollapseOthers,
}) {
  const [title, setTitle] = useState('');
  // While a card is dragged over the column: the id of the card it would land before, or null for the end.
  const [dropBefore, setDropBefore] = useState(undefined);
  const list = useRef(null);
  const section = useRef(null);
  const dragOver = dropBefore !== undefined;
  // While another column of the set is dragged over this one: which side of it it would land on.
  const [columnDrop, setColumnDrop] = useState(null);
  const [dragging, setDragging] = useState(false);
  // Pressed in a text field: dragging there selects text instead of moving the column.
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const reset = () => {
      setDropBefore(undefined);
      setColumnDrop(null);
      setDragging(false);
    };
    window.addEventListener('dragend', reset);
    return () => window.removeEventListener('dragend', reset);
  }, []);

  // A double click keeps only this column expanded. A single one expands a collapsed column (waiting to see whether
  // it is a double one) and does nothing to an expanded one; from the keyboard it toggles.
  // Clicks that start by taking the focus out of a text field only do that.
  const clickTimer = useRef(null);
  const blurClick = useRef(false);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const noteBlur = (e) => {
    if (e.detail <= 1) {
      blurClick.current = Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'));
    }
  };
  function handleClicks(e) {
    clearTimeout(clickTimer.current);
    if (e.detail === 0) {
      onToggleCollapsed();
      return;
    }
    if (blurClick.current) return;
    if (e.detail === 1) {
      if (collapsed) clickTimer.current = setTimeout(onToggleCollapsed, 250);
    } else if (e.detail === 2) {
      window.getSelection()?.removeAllRanges();
      onCollapseOthers();
    }
  }

  // The column (or the collapsed strip) drags as a whole, when the set's columns can be changed here.
  // Cards dragged inside it bubble their drag events up and are left alone.
  const columnDrag = !readOnly && edit ? {
    draggable: true,
    onDragStart: (e) => {
      if (e.target !== e.currentTarget) return;
      draggedColumnId = column.id;
      e.dataTransfer.setData('text/column-id', column.id);
      if (section.current) {
        const r = section.current.getBoundingClientRect();
        e.dataTransfer.setDragImage(section.current, e.clientX - r.left, e.clientY - r.top);
      }
      e.dataTransfer.effectAllowed = 'move';
      setDragging(true);
    },
    onDragEnd: (e) => {
      if (e.target !== e.currentTarget) return;
      draggedColumnId = null;
    },
  } : {};

  function handleDragOver(e) {
    if (draggedColumnId) {
      if (draggedColumnId === column.id || !edit?.columns.some((c) => c.id === draggedColumnId)) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setColumnDrop(e.clientX < r.left + r.width / 2 ? 'before' : 'after');
      return;
    }
    e.preventDefault();
    if (!list.current) {
      setDropBefore(null);
      return;
    }
    const target = [...list.current.querySelectorAll(':scope > .card')].find((el) => {
      const rect = el.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    setDropBefore(target?.dataset.cardId ?? null);
  }

  function handleDrop(e) {
    e.preventDefault();
    if (draggedColumnId) {
      const ids = edit.columns.map((c) => c.id).filter((id) => id !== draggedColumnId);
      moveColumnTo(draggedColumnId, ids.indexOf(column.id) + (columnDrop === 'after' ? 1 : 0));
      draggedColumnId = null;
      setColumnDrop(null);
      return;
    }
    const beforeId = dropBefore ?? null;
    setDropBefore(undefined);
    const id = e.dataTransfer.getData('text/card-id');
    if (!id || id === beforeId) return;
    const fromInbox = e.dataTransfer.types.includes('text/inbox');
    if (fromInbox && !target) return;

    const others = cards.filter((c) => c.id !== id);
    const position = beforeId ? positionBefore(others, beforeId) : positionAtEnd(others);
    moveCard(id, column.id, position, fromInbox ? target : null);
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

  const count = cards.filter((c) => !c.deleted).length;
  const color = columnColor(column);
  const columnClasses = [
    dragOver && 'column-dragover', columnDrop && `column-drop-${columnDrop}`, dragging && 'column-dragging',
    color && 'column-colored',
  ].filter(Boolean).join(' ');
  const columnStyle = color ? { '--column-color': color } : undefined;
  const menu = (
    <ColumnMenu column={column} prevColumn={readOnly ? null : prevColumn} nextColumn={readOnly ? null : nextColumn}
      moveAll={!readOnly && movable.length ? moveAll : null} edit={readOnly ? null : edit}
      collapsed={collapsed} onCollapse={onToggleCollapsed} hoverRef={section} />
  );
  if (collapsed) {
    return (
      <section
        ref={section}
        className={`column column-collapsed ${columnClasses}`}
        style={columnStyle}
        onMouseDownCapture={noteBlur}
        onDragOver={readOnly ? undefined : handleDragOver}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setDropBefore(undefined);
          setColumnDrop(null);
        }}
        onDrop={readOnly ? undefined : handleDrop}
      >
        {menu}
        <button type="button" className="column-expand" onClick={handleClicks} {...columnDrag}
          title={`Развернуть колонку «${column.name}»`} aria-label={`Развернуть колонку «${column.name}»`} aria-expanded="false">
          <span className="column-expand-title">
            <span className="column-expand-name">{column.name}</span> <span className="count">{count}</span>
          </span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={section}
      className={`column ${columnClasses}`}
      style={columnStyle}
      onMouseDownCapture={noteBlur}
      onClick={(e) => {
        // Clicks from menus portaled out of the column bubble here too.
        if (!e.currentTarget.contains(e.target)) return;
        if (e.target.closest('.card, a, button, input, textarea, form, [role="button"]')) return;
        handleClicks(e);
      }}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
          setDropBefore(undefined);
          setColumnDrop(null);
      }}
      onDrop={readOnly ? undefined : handleDrop}
      {...columnDrag}
      draggable={columnDrag.draggable && !typing}
      onMouseDown={(e) => setTyping(!!e.target.closest('input, textarea'))}
    >
      <div className="column-head">
        <h2>
          {edit
            ? <EditableName value={column.name} label="Название колонки" maxLength={100}
              note={edit.boards.length > 1
                ? `Набор «${edit.setName}» используют доски: ${edit.boards.map((b) => `«${b}»`).join(', ')}. Изменение применится ко всем.`
                : null}
              onSave={(name) => renameColumn(column.id, name)} />
            : column.name} <span className="count">{count}</span>
        </h2>
        <div className="column-moves">{menu}</div>
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

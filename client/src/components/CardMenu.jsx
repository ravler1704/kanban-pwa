import { useEffect, useState } from 'react';
import { deleteCard, duplicateCard, moveCardTo, moveCardToColumn, moveCardToEdge, setCardDone } from '../actions.js';
import { authState } from '../auth.js';
import { currentBoard, publicToken } from '../board.js';
import { INBOX_ID } from '../db.js';
import { cardColorItems } from '../appearance.js';
import { ICONS } from '../menuIcons.js';
import ContextMenu, { useHoverShortcuts, useMenuButton } from './ContextMenu.jsx';

/** A link that opens the card (on its board) for anyone with access to it. */
function cardLink(id) {
  const owner = currentBoard ?? authState.get().user?.id;
  return `${location.origin}/?${new URLSearchParams({ ...(owner && { board: owner }), card: id })}`;
}

/** Separators only between groups of items. */
function tidy(items) {
  const out = [];
  for (const item of items) {
    if (item === false || item === undefined) continue;
    if (item === null && (!out.length || out[out.length - 1] === null)) continue;
    out.push(item);
  }
  if (out[out.length - 1] === null) out.pop();
  return out;
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/**
 * The «⋯» menu of a card on the board, also opened by a right click on the card (`hoverRef`);
 * its shortcuts work with the pointer over the card.
 */
export default function CardMenu({ card, prevColumn, nextColumn, readOnly, onOpen, hoverRef }) {
  const [menu, setMenu, closeMenu, menuButton] = useMenuButton(260);
  const [copied, setCopied] = useState(false);
  const editable = !readOnly && !card.conflict;

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const items = tidy([
    { label: 'Открыть', icon: ICONS.open, run: onOpen },
    editable && {
      label: card.done ? 'Снять отметку «Выполнена»' : 'Отметить выполненной', icon: ICONS.done, shortcut: 'KeyX',
      active: Boolean(card.done), run: () => setCardDone(card.id, !card.done),
    },
    null,
    editable && prevColumn && {
      label: `В «${prevColumn.name}»`, icon: ICONS.left, shortcut: 'Shift+ArrowLeft',
      run: () => moveCardToColumn(card.id, prevColumn.id),
    },
    editable && nextColumn && {
      label: `В «${nextColumn.name}»`, icon: ICONS.right, shortcut: 'Shift+ArrowRight',
      run: () => moveCardToColumn(card.id, nextColumn.id),
    },
    editable && { label: 'В начало колонки', icon: ICONS.toTop, shortcut: 'Shift+ArrowUp', run: () => moveCardToEdge(card.id, true) },
    editable && { label: 'В конец колонки', icon: ICONS.toBottom, shortcut: 'Shift+ArrowDown', run: () => moveCardToEdge(card.id, false) },
    null,
    editable && { label: 'Цвет', icon: ICONS.palette, submenu: cardColorItems(card) },
    editable && !publicToken && {
      label: 'Во «Входящие»', icon: ICONS.inbox, shortcut: 'KeyI', run: () => moveCardTo(card.id, INBOX_ID),
    },
    null,
    !publicToken && {
      label: 'Копировать ссылку', icon: ICONS.link, shortcut: 'KeyL',
      run: () => navigator.clipboard?.writeText(cardLink(card.id)).then(() => setCopied(true), () => {}),
    },
    editable && { label: 'Дублировать', icon: ICONS.copy, shortcut: 'KeyD', run: () => duplicateCard(card.id) },
    null,
    editable && {
      label: 'Удалить карточку', icon: ICONS.trash, shortcut: 'Delete', danger: true,
      run: () => confirm('Удалить карточку?') && deleteCard(card.id),
    },
  ]);
  const useful = items.length > 1;
  useHoverShortcuts(hoverRef, useful ? items : []);

  useEffect(() => {
    const el = hoverRef.current;
    if (!el || !useful) return undefined;
    const onContextMenu = (e) => {
      if (e.target.closest('a, input, textarea')) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    el.addEventListener('contextmenu', onContextMenu);
    return () => el.removeEventListener('contextmenu', onContextMenu);
  }, [hoverRef, useful]);

  if (!useful) return null;
  return (
    <>
      {copied && <span className="card-copied" role="status">Ссылка скопирована</span>}
      <button type="button" className={`btn btn-icon card-menu-btn ${menu ? 'active' : ''}`}
        title="Действия с карточкой (их клавиши работают и при наведении на карточку)"
        aria-label="Действия с карточкой" {...menuButton}>
        <MoreIcon />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
    </>
  );
}

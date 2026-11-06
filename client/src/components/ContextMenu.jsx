import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_NAMES = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: MAC ? '⌫' : 'Del',
};
const MOD_NAMES = MAC ? { Mod: '⌘', Shift: '⇧', Alt: '⌥' } : { Mod: 'Ctrl+', Shift: 'Shift+', Alt: 'Alt+' };

/** «Shift+ArrowLeft», «KeyT», «F2», «Mod+KeyC» (⌘ on Mac, Ctrl elsewhere) as shown to the user. */
export function shortcutLabel(spec) {
  const parts = spec.split('+');
  const key = parts.pop();
  return parts.map((m) => MOD_NAMES[m]).join('') + (KEY_NAMES[key] ?? key.replace(/^Key/, ''));
}

// Letters are matched by the physical key (e.code), so they work in any keyboard layout.
function matches(spec, e) {
  const parts = spec.split('+');
  const key = parts.pop();
  if (parts.includes('Shift') !== e.shiftKey || parts.includes('Alt') !== e.altKey
    || parts.includes('Mod') !== (MAC ? e.metaKey : e.ctrlKey)) return false;
  if (key === 'Delete') return e.key === 'Delete' || e.key === 'Backspace';
  return e.code === key || e.key === key;
}

/** The keyboard shortcut of `items` (see ContextMenu) pressed in `e`, if any. */
export const itemForKey = (items, e) => items.find((item) => item && !item.disabled && item.shortcut && matches(item.shortcut, e));

/**
 * The shortcuts of the menu `items` work while the pointer is over `ref` too: not while typing,
 * with a menu open (it takes them) or under a dialog that does not contain the element.
 */
export function useHoverShortcuts(ref, items) {
  const latest = useRef(items);
  latest.current = items;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const entry = { el, hovered: false, items: () => latest.current };
    const enter = () => { entry.hovered = true; };
    const leave = () => { entry.hovered = false; };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    hoverEntries.add(entry);
    if (hoverEntries.size === 1) window.addEventListener('keydown', onHoverKey);
    return () => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      hoverEntries.delete(entry);
      if (!hoverEntries.size) window.removeEventListener('keydown', onHoverKey);
    };
  }, [ref]);
}

const hoverEntries = new Set();

// One listener for all hovered elements: the innermost one (a card in a column) gets the key first.
function onHoverKey(e) {
  if (e.defaultPrevented || e.repeat) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('.context-menu')) return;
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const top = dialogs[dialogs.length - 1];
  const hovered = [...hoverEntries]
    .filter((h) => h.hovered && h.el.isConnected && (!top || top.contains(h.el)))
    .sort((a, b) => (a.el.contains(b.el) ? 1 : b.el.contains(a.el) ? -1 : 0));
  for (const h of hovered) {
    const item = itemForKey(h.items(), e);
    if (item) {
      e.preventDefault();
      item.run();
      return;
    }
  }
}

const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/**
 * The rows of a menu; `onPick(item)` is called on a click. An item with a `submenu` calls `onSub(item, its row)`
 * instead, on a click or the pointer coming over it (with `focus` for a keyboard click); the pointer over another
 * row calls `onSub(null)`.
 */
export function MenuItems({ items, onPick, onSub, openSub }) {
  const icons = items.some((item) => item?.icon);
  return items.map((item, i) => (item ? (
    <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
      aria-keyshortcuts={item.shortcut} title={item.title}
      aria-haspopup={item.submenu ? 'menu' : undefined} aria-expanded={item.submenu ? openSub === item : undefined}
      className={`context-menu-item ${item.danger ? 'context-menu-danger' : ''} ${item.active ? 'context-menu-active' : ''}
        ${openSub === item ? 'context-menu-open' : ''}`}
      onMouseEnter={onSub && ((e) => onSub(item.submenu ? item : null, e.currentTarget, false))}
      data-index={i} onClick={(e) => (item.submenu ? onSub(item, e.currentTarget, e.detail === 0) : onPick(item))}>
      {icons && <span className="context-menu-icon">{item.icon && <Icon d={item.icon} />}</span>}
      <span className="context-menu-label">{item.label}</span>
      {item.hint != null && <span className="context-menu-hint">{item.hint}</span>}
      {item.shortcut && <kbd className="context-menu-key">{shortcutLabel(item.shortcut)}</kbd>}
      {item.submenu && <span className="context-menu-arrow" aria-hidden="true">›</span>}
    </button>
  ) : <hr key={i} className="context-menu-sep" />));
}

/** The submenu of the row at `rect`: on its right, or its left if it doesn't fit there. */
function SubMenu({ rect, items, onPick, menuRef }) {
  const [pos, setPos] = useState({ left: rect.right, top: rect.top });
  useLayoutEffect(() => {
    const { width, height } = menuRef.current.getBoundingClientRect();
    const left = rect.right + width + 8 <= window.innerWidth ? rect.right + 2 : rect.left - width - 2;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.top - 5, window.innerHeight - height - 8)),
    });
  }, [rect, menuRef]);
  return (
    <div ref={menuRef} className="context-menu" role="menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
      <MenuItems items={items} onPick={onPick} />
    </div>
  );
}

/** The click that closes a menu only closes it, as in system menus: it doesn't reach the page under it. */
function swallowNextClick() {
  const swallow = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('mouseup', () => setTimeout(() => window.removeEventListener('click', swallow, true)), {
    capture: true, once: true,
  });
}

/**
 * A «⋯» button's menu, `width` wide under its right edge, opened and closed by clicking the button.
 * Returns [menu, setMenu (for right clicks), closeMenu, the button's props].
 */
export function useMenuButton(width) {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const button = {
    'aria-haspopup': 'menu',
    'aria-expanded': Boolean(menu),
    onMouseDown: (e) => menu && e.stopPropagation(),
    onClick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setMenu(menu ? null : { x: r.right - width, y: r.bottom + 4 });
    },
  };
  return [menu, setMenu, closeMenu, button];
}

/** Keeps the menu inside the window once its size is known. */
export function useMenuPosition(x, y) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);
  return [ref, pos];
}

/**
 * A menu at `x`, `y` (viewport) of `items`: { label, run, icon? (an SVG path), shortcut?, hint? (muted, on the right),
 * title?, danger?, disabled?, active?, submenu? (items, instead of run) }, null for a separator. ↑ and ↓ move between
 * the items, → and ← open and leave a submenu, a shortcut runs its item.
 * Closes on a pick, Escape, a click outside, scrolling or resizing.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const [ref, pos] = useMenuPosition(x, y);
  const subRef = useRef(null);
  // The open submenu: { item, row (its element), rect, focus (its first row, when opened from the keyboard) }.
  const [sub, setSub] = useState(null);
  const openSub = useCallback((item, row, focus = false) => {
    setSub((cur) => (!item ? null : cur?.item === item && !focus ? cur : { item, row, rect: row.getBoundingClientRect(), focus }));
  }, []);

  useEffect(() => {
    if (sub?.focus) subRef.current?.querySelector('.context-menu-item:not(:disabled)')?.focus();
  }, [sub]);

  useEffect(() => {
    const onKey = (e) => {
      const inSub = subRef.current?.contains(document.activeElement);
      // Not the modal or the page under the menu.
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && inSub) {
        e.preventDefault();
        e.stopPropagation();
        sub.row.focus();
        setSub(null);
        return;
      }
      if (e.key === 'ArrowRight' && !inSub) {
        const row = document.activeElement;
        const item = ref.current.contains(row) && items[row.dataset.index];
        if (item?.submenu) {
          e.preventDefault();
          e.stopPropagation();
          openSub(item, row, true);
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const buttons = [...(inSub ? subRef : ref).current.querySelectorAll('.context-menu-item:not(:disabled)')];
        const at = buttons.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at <= 0 ? buttons.length : at) - 1;
        buttons[next]?.focus();
        return;
      }
      const item = itemForKey(items, e);
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      item.run();
    };
    const onOutside = () => {
      onClose();
      swallowNextClick();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [items, onClose, ref, sub, openSub]);

  const pick = (item) => {
    onClose();
    item.run();
  };
  return createPortal(
    <>
      <div ref={ref} className="context-menu" role="menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
        <MenuItems items={items} onPick={pick} openSub={sub?.item} onSub={openSub} />
      </div>
      {sub && <SubMenu rect={sub.rect} items={sub.item.submenu} onPick={pick} menuRef={subRef} />}
    </>,
    document.body,
  );
}

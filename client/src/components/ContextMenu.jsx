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

/** The rows of a menu; `onPick(item)` is called on a click. */
export function MenuItems({ items, onPick }) {
  const icons = items.some((item) => item?.icon);
  return items.map((item, i) => (item ? (
    <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
      aria-keyshortcuts={item.shortcut}
      className={`context-menu-item ${item.danger ? 'context-menu-danger' : ''} ${item.active ? 'context-menu-active' : ''}`}
      onClick={() => onPick(item)}>
      {icons && <span className="context-menu-icon">{item.icon && <Icon d={item.icon} />}</span>}
      <span className="context-menu-label">{item.label}</span>
      {item.shortcut && <kbd className="context-menu-key">{shortcutLabel(item.shortcut)}</kbd>}
    </button>
  ) : <hr key={i} className="context-menu-sep" />));
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
 * A menu at `x`, `y` (viewport) of `items`: { label, run, icon? (an SVG path), shortcut?, danger?, disabled?,
 * active? }, null for a separator. ↑ and ↓ move between the items, a shortcut runs its item.
 * Closes on a pick, Escape, a click outside, scrolling or resizing.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const [ref, pos] = useMenuPosition(x, y);

  useEffect(() => {
    const onKey = (e) => {
      // Not the modal or the page under the menu.
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const buttons = [...ref.current.querySelectorAll('.context-menu-item:not(:disabled)')];
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
  }, [items, onClose, ref]);

  return createPortal(
    <div ref={ref} className="context-menu" role="menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
      <MenuItems items={items} onPick={(item) => {
        onClose();
        item.run();
      }} />
    </div>,
    document.body,
  );
}

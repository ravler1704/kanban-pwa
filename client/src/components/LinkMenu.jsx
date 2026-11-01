import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { linkAt, normalizeAddress } from '../links.js';

const LINK_WORD = 'ссылка';

/**
 * Replaces [from, to] of the field with `text` the way typing does (undo works, React sees the change),
 * then selects [selectFrom, selectTo] of the new value.
 */
function replace(el, from, to, text, selectFrom, selectTo) {
  el.focus();
  el.setSelectionRange(from, to);
  if (!document.execCommand('insertText', false, text)) {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    set.call(el, el.value.slice(0, from) + text + el.value.slice(to));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(selectFrom, selectTo);
}

function askAddress(current = '') {
  const input = window.prompt('Адрес ссылки', current);
  if (input == null) return null;
  const url = normalizeAddress(input);
  if (!url) alert('Это не похоже на адрес ссылки');
  return url;
}

/** Menu items for the field `el`; empty when it has nothing about links to offer. */
function linkItems(el) {
  const { value, selectionStart: start, selectionEnd: end } = el;
  const link = linkAt(value, start, end);
  const open = (href) => ({ label: 'Открыть ссылку', run: () => window.open(href, '_blank', 'noopener') });
  if (link && !link.bare) {
    return [
      open(link.href),
      {
        label: 'Изменить адрес…',
        run: () => {
          const url = askAddress(link.url);
          if (!url) return;
          const text = `[${link.label}](${url})`;
          replace(el, link.from, link.to, text, link.from + text.length, link.from + text.length);
        },
      },
      {
        label: 'Убрать ссылку',
        run: () => replace(el, link.from, link.to, link.label, link.from, link.from + link.label.length),
      },
    ];
  }
  if (link) {
    return [
      open(link.href),
      {
        label: 'Показывать словом',
        run: () => replace(el, link.from, link.to, `[${LINK_WORD}](${link.url})`,
          link.from + 1, link.from + 1 + LINK_WORD.length),
      },
    ];
  }
  const selected = value.slice(start, end);
  if (!selected.trim() || selected.includes('\n')) return [];
  return [{
    label: 'Сделать ссылкой…',
    run: () => {
      const url = askAddress();
      if (!url) return;
      const text = `[${selected}](${url})`;
      replace(el, start, end, text, start + text.length, start + text.length);
    },
  }];
}

function clipboardItems(el) {
  const selected = el.selectionStart !== el.selectionEnd;
  return [
    selected && { label: 'Вырезать', run: () => { el.focus(); document.execCommand('cut'); } },
    selected && { label: 'Копировать', run: () => { el.focus(); document.execCommand('copy'); } },
    navigator.clipboard?.readText && {
      label: 'Вставить',
      run: async () => {
        const text = await navigator.clipboard.readText().catch(() => null);
        if (text) replace(el, el.selectionStart, el.selectionEnd, text,
          el.selectionStart + text.length, el.selectionStart + text.length);
      },
    },
  ].filter(Boolean);
}

/**
 * Right click in a text field with a selection or on a link opens a menu to make, change or remove the
 * link; elsewhere the browser's own menu stays. Returns the field's `onContextMenu` and the menu to render.
 */
export function useLinkMenu() {
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Not the modal under the menu.
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  function onContextMenu(e) {
    const el = e.currentTarget;
    const items = linkItems(el);
    if (items.length === 0) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: [...items, null, ...clipboardItems(el)] });
  }

  const node = menu && createPortal(
    <div className="context-menu" role="menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 40 * menu.items.length) }}
      // Keeps the field focused with its selection; the window listener would close the menu first.
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {menu.items.map((item, i) => (item ? (
        <button key={item.label} type="button" role="menuitem" className="context-menu-item"
          onClick={() => {
            setMenu(null);
            item.run();
          }}>
          {item.label}
        </button>
      ) : <hr key={i} className="context-menu-sep" />))}
    </div>,
    document.body,
  );

  return { onContextMenu, menu: node };
}

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu at `x`, `y` (viewport) of `items`: { label, run, danger?, disabled?, active? }, null for a separator.
 * Closes on a pick, Escape, a click outside, scrolling or resizing.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Not the modal under the menu.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div className="context-menu" role="menu"
      style={{ left: Math.max(8, Math.min(x, window.innerWidth - 230)), top: Math.max(8, Math.min(y, window.innerHeight - 38 * items.length - 16)) }}
      onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item, i) => (item ? (
        <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
          className={`context-menu-item ${item.danger ? 'context-menu-danger' : ''} ${item.active ? 'context-menu-active' : ''}`}
          onClick={() => {
            onClose();
            item.run();
          }}>
          {item.label}
        </button>
      ) : <hr key={i} className="context-menu-sep" />))}
    </div>,
    document.body,
  );
}

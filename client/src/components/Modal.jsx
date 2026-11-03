import { useEffect, useRef } from 'react';

/** `closeButton`: a × in the corner, for dialogs without their own «Закрыть». */
export default function Modal({ title, onClose, className = '', closeButton = false, children }) {
  const backdrop = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Only the topmost of nested modals reacts.
      const all = document.querySelectorAll('.modal-backdrop');
      if (all[all.length - 1] === backdrop.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" ref={backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-label={title}>
        {closeButton ? (
          <div className="modal-head">
            <h3>{title}</h3>
            <button type="button" className="btn btn-small btn-icon-only modal-close" onClick={onClose}
              aria-label="Закрыть" title="Закрыть">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ) : <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

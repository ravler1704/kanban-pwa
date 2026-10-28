import { useEffect, useRef } from 'react';

export default function Modal({ title, onClose, children }) {
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
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

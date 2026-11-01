import { useLayoutEffect, useRef, useState } from 'react';
import { pasteAsLink } from '../links.js';
import { useLinkMenu } from './LinkMenu.jsx';

/** Card title: always as tall as its text. */
export default function TitleField({ value, onChange, autoFocus }) {
  const input = useRef(null);
  // Caret to set once the pasted text is rendered.
  const [caret, setCaret] = useState(null);
  const linkMenu = useLinkMenu();

  useLayoutEffect(() => {
    const el = input.current;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  useLayoutEffect(() => {
    if (caret == null) return;
    input.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret]);

  return (
    <label className="field">
      <span className="field-label">Название</span>
      <textarea ref={input} className="title-input" rows={1}
        value={value} maxLength={500} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
        onPaste={(e) => {
          const next = pasteAsLink(e.currentTarget, e.clipboardData.getData('text/plain'));
          if (!next) return;
          e.preventDefault();
          onChange(next.value);
          setCaret(next.caret);
        }}
        onContextMenu={linkMenu.onContextMenu}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }} />
      {linkMenu.menu}
    </label>
  );
}

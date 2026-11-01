import { useLayoutEffect, useRef, useState } from 'react';
import { addressToLink, pasteAsLink } from '../links.js';
import FieldLinks from './FieldLinks.jsx';

/** Card title: always as tall as its text. */
export default function TitleField({ value, onChange, autoFocus }) {
  const input = useRef(null);
  // Selection to set once the changed text is rendered: [start, end].
  const [select, setSelect] = useState(null);

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
    if (!select) return;
    input.current.focus();
    input.current.setSelectionRange(...select);
    setSelect(null);
  }, [select]);

  function makeWord(url) {
    const next = addressToLink(value, url);
    if (!next) return;
    onChange(next.value);
    setSelect(next.select);
  }

  return (
    <>
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
            setSelect([next.caret, next.caret]);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }} />
      </label>
      <FieldLinks text={value} onMakeWord={makeWord} />
    </>
  );
}

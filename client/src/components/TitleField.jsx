import { useLayoutEffect, useRef } from 'react';

/** Card title: always as tall as its text. */
export default function TitleField({ value, onChange, autoFocus }) {
  const input = useRef(null);

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

  return (
    <label className="field">
      <span className="field-label">Название</span>
      <textarea ref={input} className="title-input" rows={1}
        value={value} maxLength={500} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }} />
    </label>
  );
}

import { useLayoutEffect, useRef, useState } from 'react';
import { pasteAsLink } from '../links.js';
import FieldLinks from './FieldLinks.jsx';
import { useLinkMenu } from './LinkMenu.jsx';
import Markdown from './Markdown.jsx';

const MARKDOWN_HELP = 'Markdown: **жирный**, *курсив*, ~~зачёркнутый~~, `код`, [текст](адрес), '
  + 'строки «- пункт» и «1. пункт», «> цитата», «# заголовок»';

/** Expanded description; `onCollapse` is called when it loses focus while empty. */
export default function DescriptionField({ value, onChange, onCollapse, rows = 6 }) {
  const [preview, setPreview] = useState(false);
  const input = useRef(null);
  // Caret to set once the pasted text is rendered.
  const [caret, setCaret] = useState(null);
  const linkMenu = useLinkMenu();

  useLayoutEffect(() => {
    if (caret == null || !input.current) return;
    input.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret]);

  return (
    <div className="description-field">
      {preview ? (
        <div className="field description-preview">
          <span className="field-label">Описание</span>
          <Markdown text={value} />
        </div>
      ) : (
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea
            ref={input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const next = pasteAsLink(e.currentTarget, e.clipboardData.getData('text/plain'));
              if (!next) return;
              e.preventDefault();
              onChange(next.value);
              setCaret(next.caret);
            }}
            onContextMenu={linkMenu.onContextMenu}
            onBlur={() => !value && onCollapse()}
            rows={rows}
            maxLength={10000}
            autoFocus={!value}
          />
        </label>
      )}
      {linkMenu.menu}
      {value && (
        <div className="description-tools">
          <button type="button" className="btn btn-small" title={MARKDOWN_HELP} onClick={() => setPreview(!preview)}>
            {preview ? 'Редактировать' : 'Просмотр'}
          </button>
        </div>
      )}
      {!preview && <FieldLinks text={value} />}
    </div>
  );
}

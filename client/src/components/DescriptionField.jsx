import { useLayoutEffect, useRef, useState } from 'react';
import { addressToLink, linksOf, pasteAsLink } from '../links.js';
import Markdown from './Markdown.jsx';

const MARKDOWN_HELP = 'Markdown: **жирный**, *курсив*, ~~зачёркнутый~~, `код`, [текст](адрес), '
  + 'строки «- пункт» и «1. пункт», «> цитата», «# заголовок»';

/** Expanded description; `onCollapse` is called when it loses focus while empty. */
export default function DescriptionField({ value, onChange, onCollapse, rows = 6 }) {
  const [preview, setPreview] = useState(false);
  const input = useRef(null);
  // Selection to set once the changed text is rendered: [start, end].
  const [select, setSelect] = useState(null);
  const links = linksOf(value);

  useLayoutEffect(() => {
    if (!select || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(...select);
    setSelect(null);
  }, [select]);

  function makeWord(url) {
    const next = addressToLink(value, url);
    if (!next) return;
    setPreview(false);
    onChange(next.value);
    setSelect(next.select);
  }

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
              setSelect([next.caret, next.caret]);
            }}
            onBlur={() => !value && onCollapse()}
            rows={rows}
            maxLength={10000}
            autoFocus={!value}
          />
        </label>
      )}
      <div className="description-tools">
        <span className="muted description-hint" title={MARKDOWN_HELP}>
          Выделите слово и вставьте адрес — слово станет ссылкой
        </span>
        {value && (
          <button type="button" className="btn btn-small" onClick={() => setPreview(!preview)}>
            {preview ? 'Редактировать' : 'Просмотр'}
          </button>
        )}
      </div>
      {!preview && links.length > 0 && (
        <div className="field-links">
          {links.map((link) => (
            <span key={link.href} className="field-link">
              <a className="link" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
                {link.url}
              </a>
              {link.bare && (
                <button type="button" className="field-link-word" onClick={() => makeWord(link.url)}
                  title="Показывать вместо адреса слово">
                  сделать словом
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { linksOf } from '../links.js';
import Markdown from './Markdown.jsx';

/** Expanded description; `onCollapse` is called when it loses focus while empty. */
export default function DescriptionField({ value, onChange, onCollapse, rows = 6 }) {
  const [preview, setPreview] = useState(false);
  const links = linksOf(value);
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
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => !value && onCollapse()}
            rows={rows}
            maxLength={10000}
            autoFocus={!value}
          />
        </label>
      )}
      <div className="description-tools">
        <span className="muted description-hint">
          Markdown: **жирный**, *курсив*, [текст](адрес), - список
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
            <a key={link.href} className="link" href={link.href} target="_blank" rel="noopener noreferrer"
              title={link.href}>
              {link.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

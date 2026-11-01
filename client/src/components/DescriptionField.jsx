import { linksOf } from '../links.js';

/** Expanded description; `onCollapse` is called when it loses focus while empty. */
export default function DescriptionField({ value, onChange, onCollapse, rows = 6 }) {
  const links = linksOf(value);
  return (
    <div className="description-field">
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
      {links.length > 0 && (
        <div className="field-links">
          {links.map((link) => (
            <a key={link.href} className="link" href={link.href} target="_blank" rel="noopener noreferrer"
              title={link.url}>
              {link.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

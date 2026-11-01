import { linksOf } from '../links.js';

/** Links found in a field's text; bare addresses can be turned into a word with `onMakeWord(url)`. */
export default function FieldLinks({ text, onMakeWord }) {
  const links = linksOf(text);
  if (links.length === 0) return null;
  return (
    <div className="field-links">
      {links.map((link) => (
        <span key={link.href} className="field-link">
          <a className="link" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
            {link.url}
          </a>
          {link.bare && (
            <button type="button" className="field-link-word" onClick={() => onMakeWord(link.url)}
              title="Показывать вместо адреса слово">
              сделать словом
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

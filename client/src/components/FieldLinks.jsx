import { linksOf } from '../links.js';

/** Links found in a field's text. */
export default function FieldLinks({ text }) {
  const links = linksOf(text);
  if (links.length === 0) return null;
  return (
    <div className="field-links">
      {links.map((link) => (
        <a key={link.href} className="link" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
          {link.url}
        </a>
      ))}
    </div>
  );
}

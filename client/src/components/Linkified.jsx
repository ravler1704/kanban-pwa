import { Fragment } from 'react';
import { splitLinks } from '../links.js';

/** Text with its links opening in a new tab; `renderText` renders the parts between links. */
export default function Linkified({ text, renderText = (part) => part }) {
  return splitLinks(text).map((part, i) => (typeof part === 'string'
    ? <Fragment key={i}>{renderText(part)}</Fragment>
    : (
      <a key={i} className="link" href={part.href} target="_blank" rel="noopener noreferrer"
        draggable={false} onClick={(e) => e.stopPropagation()}>
        {part.url}
      </a>
    )));
}

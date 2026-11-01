// A trailing dot, comma, bracket or quote ends the sentence, not the link.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]}'»])/i;
// Markdown link [text](address).
export const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

const hrefOf = (url) => (/^www\./i.test(url) ? `http://${url}` : url);

/** Where a Markdown link may lead (no `javascript:` and the like), or null. */
export function safeHref(url) {
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  return /^www\./i.test(url) ? hrefOf(url) : null;
}

/** Markdown links shown as their text, for places without links (chat headers, calendar, notices). */
export const withoutLinks = (text) => (text ?? '').replace(MD_LINK_RE, '$1');

/** Text split into plain strings and { url, href } parts, in order. */
export function splitLinks(text) {
  return (text ?? '').split(new RegExp(URL_RE.source, 'gi'))
    .map((part, i) => (i % 2 ? { url: part, href: hrefOf(part) } : part))
    .filter((part) => part !== '');
}

/** Distinct links of the text: Markdown ones ({ url: their text }) and bare addresses ({ bare: true }). */
export function linksOf(text) {
  const seen = new Map();
  const rest = (text ?? '').replace(MD_LINK_RE, (whole, label, url) => {
    const href = safeHref(url);
    if (!href) return whole;
    if (!seen.has(href)) seen.set(href, { url: label, href });
    return ' ';
  });
  for (const part of splitLinks(rest)) {
    if (typeof part !== 'string' && !seen.has(part.href)) seen.set(part.href, { ...part, bare: true });
  }
  return [...seen.values()];
}

const isAddress = (text) => /^(https?:\/\/|www\.)\S+$/i.test(text);

/**
 * An address pasted over selected text makes it a link: the new value and caret
 * ({ value, caret }) for the field `el`, or null for an ordinary paste.
 */
export function pasteAsLink(el, pasted) {
  const url = pasted.trim();
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end);
  if (start === end || !isAddress(url) || !selected.trim() || selected.includes('\n') || isAddress(selected.trim())) {
    return null;
  }
  const link = `[${selected}](${url})`;
  return { value: value.slice(0, start) + link + value.slice(end), caret: start + link.length };
}

export const LINK_WORD = 'ссылка';

/**
 * The bare address `url` in `text` made a Markdown link with a placeholder word:
 * { value, select: [start, end] of the word }, or null if it isn't there.
 */
export function addressToLink(text, url) {
  let at = text.indexOf(url);
  while (at > 0 && text.slice(at - 2, at) === '](') at = text.indexOf(url, at + 1);
  if (at < 0) return null;
  return {
    value: `${text.slice(0, at)}[${LINK_WORD}](${url})${text.slice(at + url.length)}`,
    select: [at + 1, at + 1 + LINK_WORD.length],
  };
}

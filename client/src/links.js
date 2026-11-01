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

// A caret touching a link from outside is not in it; a selection may cover it whole.
const covers = (from, to, start, end) => (start === end ? from < start && start < to : from <= start && end <= to);

/**
 * The link the selection [start, end] of the text is in: { from, to, label, url, href } for a Markdown
 * link, { from, to, url, href, bare: true } for an address, or null.
 */
export function linkAt(text, start, end) {
  for (const m of text.matchAll(MD_LINK_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (covers(from, to, start, end)) {
      const href = safeHref(m[2]);
      return href ? { from, to, label: m[1], url: m[2], href } : null;
    }
  }
  // Markdown links blanked out with the same length, so that positions stay.
  const rest = text.replace(MD_LINK_RE, (whole) => ' '.repeat(whole.length));
  let from = 0;
  for (const part of splitLinks(rest)) {
    const length = typeof part === 'string' ? part.length : part.url.length;
    if (typeof part !== 'string' && covers(from, from + length, start, end)) {
      return { from, to: from + length, url: part.url, href: part.href, bare: true };
    }
    from += length;
  }
  return null;
}

/** An address typed by hand: `example.com` gets `https://`; null if it can't be a link. */
export function normalizeAddress(input) {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (safeHref(url)) return url;
  return /^[^\s/:]+\.[^\s/:]+/.test(url) ? `https://${url}` : null;
}

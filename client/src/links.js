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

/** Text split into plain strings and { url, href } parts, in order. */
export function splitLinks(text) {
  return (text ?? '').split(new RegExp(URL_RE.source, 'gi'))
    .map((part, i) => (i % 2 ? { url: part, href: hrefOf(part) } : part))
    .filter((part) => part !== '');
}

/** Distinct links of the text: Markdown ones ({ url: their text }) and bare addresses. */
export function linksOf(text) {
  const seen = new Map();
  const rest = (text ?? '').replace(MD_LINK_RE, (whole, label, url) => {
    const href = safeHref(url);
    if (!href) return whole;
    if (!seen.has(href)) seen.set(href, { url: label, href });
    return ' ';
  });
  for (const part of splitLinks(rest)) if (typeof part !== 'string' && !seen.has(part.href)) seen.set(part.href, part);
  return [...seen.values()];
}

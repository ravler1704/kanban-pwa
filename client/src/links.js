// A trailing dot, comma, bracket or quote ends the sentence, not the link.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]}'»])/i;

const hrefOf = (url) => (/^www\./i.test(url) ? `http://${url}` : url);

/** Text split into plain strings and { url, href } parts, in order. */
export function splitLinks(text) {
  return (text ?? '').split(new RegExp(URL_RE.source, 'gi'))
    .map((part, i) => (i % 2 ? { url: part, href: hrefOf(part) } : part))
    .filter((part) => part !== '');
}

/** Distinct links of the text. */
export function linksOf(text) {
  const seen = new Map();
  for (const part of splitLinks(text)) if (typeof part !== 'string') seen.set(part.href, part);
  return [...seen.values()];
}

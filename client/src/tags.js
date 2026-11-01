import { splitLinks } from './links.js';

// #tag: letters, digits, _ and -, after the start of the text or a non-word character.
// Only digits (#2, «задача #15») is a number, not a tag.
const TAG_RE = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;
const isTag = (name) => /\p{L}/u.test(name);

/** Tags compare case-insensitively. */
export const tagKey = (name) => name.toLowerCase();

/** Text split into plain strings and { tag } parts, in order. */
export function splitTags(text) {
  const parts = [];
  let last = 0;
  for (const m of (text ?? '').matchAll(TAG_RE)) {
    const name = m[2].replace(/-+$/, '');
    if (!isTag(name)) continue;
    const start = m.index + m[1].length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ tag: name });
    last = start + 1 + name.length;
  }
  if (last < (text ?? '').length) parts.push(text.slice(last));
  return parts;
}

/** Tag names of the text, in order; a link's #fragment is not a tag. */
export function tagNames(text) {
  return splitLinks(text).filter((piece) => typeof piece === 'string')
    .flatMap((piece) => splitTags(piece).filter((part) => typeof part !== 'string').map((part) => part.tag));
}

/** Keys of the card's tags from its title and description. */
export function tagsOf(card) {
  const keys = new Set();
  for (const text of [card.title, card.description]) {
    for (const name of tagNames(text)) keys.add(tagKey(name));
  }
  return keys;
}

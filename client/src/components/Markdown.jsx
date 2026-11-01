import { Fragment } from 'react';
import { MD_LINK_RE, safeHref, splitLinks } from '../links.js';

// A small Markdown subset, rendered as React elements (never as HTML):
// **bold**, __bold__, *italic*, _italic_, ~~struck~~, `code`, [text](address), bare addresses;
// with `inline` unset also lines of `- ` / `1. ` lists, `> ` quotes, `# ` headings and ``` code blocks.
// «#tag» (no space) stays a tag: a heading needs a space after #.

const CODE_OR_LINK_RE = new RegExp(`(\`[^\`\\n]+\`)|${MD_LINK_RE.source}`, 'g');
const EMPHASIS_RE = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|~~([^~\n]+?)~~|(?<![\p{L}\p{N}*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\p{L}\p{N}_])/gu;

function ExternalLink({ href, children }) {
  return (
    <a className="link" href={href} target="_blank" rel="noopener noreferrer" draggable={false}
      onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}

/** Splits `text` by the global `re`; matches become `onMatch(match)`, the rest `onText(string)`. */
function scan(text, re, onMatch, onText) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(onText(text.slice(last, m.index)));
    out.push(onMatch(m));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(onText(text.slice(last)));
  return out.map((node, i) => <Fragment key={i}>{node}</Fragment>);
}

function emphasis(text, renderText) {
  return scan(text, EMPHASIS_RE, (m) => {
    const [, bold, bold2, struck, italic, italic2] = m;
    if (bold ?? bold2) return <strong>{emphasis(bold ?? bold2, renderText)}</strong>;
    if (struck) return <s>{emphasis(struck, renderText)}</s>;
    return <em>{emphasis(italic ?? italic2, renderText)}</em>;
  }, renderText);
}

function autolinks(text, renderText) {
  return splitLinks(text).map((part, i) => (
    <Fragment key={i}>
      {typeof part === 'string' ? emphasis(part, renderText) : <ExternalLink href={part.href}>{part.url}</ExternalLink>}
    </Fragment>
  ));
}

function inline(text, renderText) {
  return scan(text, CODE_OR_LINK_RE, (m) => {
    const [whole, code, label, url] = m;
    if (code) return <code className="md-code">{code.slice(1, -1)}</code>;
    const href = safeHref(url);
    return href ? <ExternalLink href={href}>{emphasis(label, (t) => t)}</ExternalLink> : autolinks(whole, renderText);
  }, (t) => autolinks(t, renderText));
}

const LIST_ITEM = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/;

/** Lines grouped into blocks: { kind, lines } (lists keep the item text). */
function blocks(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push({ kind: 'pre', lines: code });
      continue;
    }
    const item = line.match(LIST_ITEM);
    const kind = item ? (item[1] ? 'ol' : 'ul')
      : /^\s*>/.test(line) ? 'quote'
        : /^#{1,3}\s+\S/.test(line) ? 'heading'
          : line.trim() ? 'p' : 'blank';
    const content = item ? item[2] : kind === 'quote' ? line.replace(/^\s*>\s?/, '')
      : kind === 'heading' ? line.replace(/^#{1,3}\s+/, '') : line;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind && kind !== 'heading') prev.lines.push(content);
    else out.push({ kind, lines: [content], start: item?.[1] ? Number(item[1]) : undefined });
  }
  return out.filter((b) => b.kind !== 'blank');
}

const withBreaks = (lines, renderText) => lines.map((line, i) => (
  <Fragment key={i}>{i > 0 && <br />}{inline(line, renderText)}</Fragment>
));

/**
 * `text` with Markdown; `renderText(string)` renders plain text between the markup (e.g. #tags).
 * `inline`: one line of text, no blocks.
 */
export default function Markdown({ text, inline: oneLine = false, renderText = (t) => t }) {
  if (oneLine) return inline(text ?? '', renderText);
  return (
    <div className="md">
      {blocks(text ?? '').map((b, i) => {
        switch (b.kind) {
          case 'ul': return <ul key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l, renderText)}</li>)}</ul>;
          case 'ol': return <ol key={i} start={b.start}>{b.lines.map((l, j) => <li key={j}>{inline(l, renderText)}</li>)}</ol>;
          case 'quote': return <blockquote key={i}>{withBreaks(b.lines, renderText)}</blockquote>;
          case 'heading': return <p key={i} className="md-heading">{inline(b.lines[0], renderText)}</p>;
          case 'pre': return <pre key={i} className="md-pre">{b.lines.join('\n')}</pre>;
          default: return <p key={i}>{withBreaks(b.lines, renderText)}</p>;
        }
      })}
    </div>
  );
}

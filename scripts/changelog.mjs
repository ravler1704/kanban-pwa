import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Sections `## YYYY-MM-DD` from CHANGELOG.md, newest first. */
export function parseChangelog(md) {
  const releases = [];
  for (const chunk of md.split(/\n(?=## \d{4}-\d{2}-\d{2}\s*\n)/)) {
    const m = chunk.match(/^## (\d{4}-\d{2}-\d{2})\s*\n([\s\S]*)$/);
    if (!m) continue;
    const body = m[2].trim();
    if (!body) continue;
    releases.push({ date: m[1], body });
  }
  return releases;
}

export function readChangelog() {
  return readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
}

export function latestRelease(md = readChangelog()) {
  return parseChangelog(md)[0] ?? null;
}

export function formatRuDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(line) {
  return esc(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function fixImagePath(path) {
  if (path.startsWith('docs/screenshots/')) return `/changelog/${path.slice('docs/screenshots/'.length)}`;
  return path;
}

/** User-facing CHANGELOG fragment → HTML for releases.html */
export function markdownToHtml(text) {
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      closeList();
      const src = fixImagePath(img[2]);
      html += `<figure class="rel-figure"><img src="${esc(src)}" alt="${esc(img[1])}" loading="lazy" decoding="async" /></figure>`;
      continue;
    }
    if (line.startsWith('- ')) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const section = line.match(/^\*\*(.+)\*\*$/);
    if (section) {
      html += `<h3 class="rel-h3">${esc(section[1])}</h3>`;
      continue;
    }
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

export function releaseNotesForGithub(release, siteUrl) {
  return `${release.body}\n\n---\nПодробнее: ${siteUrl}/releases.html`;
}

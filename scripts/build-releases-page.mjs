#!/usr/bin/env node
import {
  cpSync, existsSync, mkdirSync, readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatRuDate, markdownToHtml, parseChangelog, readChangelog,
} from './changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'client/public');
const changelogShots = join(root, 'docs/screenshots');
const outShots = join(publicDir, 'changelog');

if (existsSync(changelogShots)) {
  mkdirSync(outShots, { recursive: true });
  for (const file of readdirSync(changelogShots)) {
    if (file.startsWith('.')) continue;
    cpSync(join(changelogShots, file), join(outShots, file), { force: true });
  }
}

const releases = parseChangelog(readChangelog());
const articles = releases.map((r) => `
  <article class="rel-card" id="${r.date}">
    <header class="rel-head">
      <time datetime="${r.date}">${formatRuDate(r.date)}</time>
      <a class="rel-gh" href="https://github.com/ravler1704/kanban-pwa/releases/tag/web-${r.date}" rel="noopener">GitHub</a>
    </header>
    <div class="rel-body">${markdownToHtml(r.body)}</div>
  </article>`).join('\n');

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0f172a" />
  <title>Что нового — Offline Kanban</title>
  <meta name="description" content="История обновлений канбан-доски Offline Kanban: новые возможности и исправления." />
  <link rel="canonical" href="https://178-83-123-195.sslip.io/releases.html" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <style>
    :root {
      --bg: #0f172a; --panel: #1e293b; --border: #334155;
      --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text);
      font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    a { color: var(--accent); }
    .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px 64px; }
    .top { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px);
      background: rgba(15, 23, 42, 0.85); border-bottom: 1px solid var(--border); }
    .top .wrap { display: flex; align-items: center; gap: 16px; min-height: 56px; padding-top: 8px; padding-bottom: 8px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-weight: 700; }
    .brand img { width: 28px; height: 28px; border-radius: 8px; }
    .top nav { margin-left: auto; display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.9rem; }
    .top nav a { color: var(--muted); text-decoration: none; }
    .top nav a:hover { color: var(--text); }
    h1 { font-size: clamp(1.75rem, 4vw, 2.25rem); margin: 32px 0 8px; letter-spacing: -0.02em; }
    .lead { color: var(--muted); margin: 0 0 28px; }
    .rel-card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
      padding: 1.1rem 1.25rem; margin-bottom: 1rem; }
    .rel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
      margin-bottom: 0.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--border); }
    .rel-head time { font-size: 1.05rem; font-weight: 700; }
    .rel-gh { font-size: 0.85rem; color: var(--muted); text-decoration: none; }
    .rel-gh:hover { color: var(--accent); }
    .rel-body p { margin: 0.45rem 0; }
    .rel-body ul { margin: 0.4rem 0 0.6rem; padding-left: 1.25rem; }
    .rel-body li { margin: 0.35rem 0; }
    .rel-h3 { margin: 0.9rem 0 0.35rem; font-size: 1rem; }
    .rel-figure { margin: 0.75rem 0 0; }
    .rel-figure img { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--border); }
    footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
      color: var(--muted); font-size: 0.88rem; display: flex; flex-wrap: wrap; gap: 12px 20px; }
    footer a { color: var(--muted); text-decoration: none; }
    footer a:hover { color: var(--text); }
  </style>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="/promo.html"><img src="/icon.svg" alt="" width="28" height="28" />Offline Kanban</a>
      <nav aria-label="Навигация">
        <a href="/promo.html">О приложении</a>
        <a href="/install.html">Установка</a>
        <a href="/">Открыть</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <h1>Что нового</h1>
    <p class="lead">Те же записи, что в <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a>
      и в <a href="https://github.com/ravler1704/kanban-pwa/releases">релизах GitHub</a>. Страница обновляется при каждой сборке.</p>
    ${articles || '<p class="lead">Пока нет записей.</p>'}
    <footer>
      <a href="/promo.html">Промо</a>
      <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>
      <a href="https://github.com/ravler1704/kanban-pwa">Исходный код</a>
    </footer>
  </main>
</body>
</html>`;

writeFileSync(join(publicDir, 'releases.html'), html);
console.log(`releases.html: ${releases.length} releases`);

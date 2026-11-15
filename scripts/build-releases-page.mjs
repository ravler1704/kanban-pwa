#!/usr/bin/env node
import {
  cpSync, existsSync, mkdirSync, readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  markdownToHtml, parseChangelog, readChangelog,
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
      <time datetime="${r.date}" data-date="${r.date}">${r.date}</time>
      <a class="rel-gh" href="https://github.com/ravler1704/kanban-pwa/releases/tag/web-${r.date}" rel="noopener">GitHub</a>
    </header>
    <div class="rel-body">${markdownToHtml(r.body)}</div>
  </article>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0f172a" />
  <title>What's new — Offline Kanban</title>
  <meta name="description" content="Offline Kanban update history: new features and fixes." />
  <link rel="canonical" href="https://178-83-123-195.sslip.io/releases.html" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <style>
    :root { --bg: #0f172a; --panel: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    a { color: var(--accent); }
    .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px 64px; }
    .top { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px); background: rgba(15, 23, 42, 0.85); border-bottom: 1px solid var(--border); }
    .top .wrap { display: flex; align-items: center; gap: 16px; min-height: 56px; padding-top: 8px; padding-bottom: 8px; flex-wrap: wrap; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-weight: 700; }
    .brand img { width: 28px; height: 28px; border-radius: 8px; }
    .top nav { margin-left: auto; display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.9rem; align-items: center; }
    .top nav a { color: var(--muted); text-decoration: none; }
    .top nav a:hover { color: var(--text); }
    h1 { font-size: clamp(1.75rem, 4vw, 2.25rem); margin: 32px 0 8px; letter-spacing: -0.02em; }
    .lead { color: var(--muted); margin: 0 0 28px; }
    .rel-card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; }
    .rel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 0.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--border); }
    .rel-head time { font-size: 1.05rem; font-weight: 700; }
    .rel-gh { font-size: 0.85rem; color: var(--muted); text-decoration: none; }
    .rel-gh:hover { color: var(--accent); }
    .rel-body p { margin: 0.45rem 0; }
    .rel-body ul { margin: 0.4rem 0 0.6rem; padding-left: 1.25rem; }
    [dir="rtl"] .rel-body ul { padding-left: 0; padding-right: 1.25rem; }
    .rel-body li { margin: 0.35rem 0; }
    .rel-h3 { margin: 0.9rem 0 0.35rem; font-size: 1rem; }
    .rel-figure { margin: 0.75rem 0 0; }
    .rel-figure img { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--border); }
    footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.88rem; display: flex; flex-wrap: wrap; gap: 12px 20px; }
    footer a { color: var(--muted); text-decoration: none; }
    footer a:hover { color: var(--text); }
  </style>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="/promo.html"><img src="/icon.svg" alt="" width="28" height="28" />Offline Kanban</a>
      <nav aria-label="Navigation">
        <a href="/promo.html" data-i18n="nav_about">About</a>
        <a href="/install.html" data-i18n="nav_install">Install</a>
        <a href="/" data-i18n="nav_open">Open</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <h1 data-i18n="h1">What's new</h1>
    <p class="lead" data-i18n-html="lead">The same entries as in <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> and <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>. This page is updated on every build.</p>
    ${articles || '<p class="lead" data-i18n="empty">No entries yet.</p>'}
    <footer>
      <a href="/promo.html" data-i18n="nav_promo">Promo</a>
      <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>
      <a href="https://github.com/ravler1704/kanban-pwa" data-i18n="nav_source">Source code</a>
    </footer>
  </main>
  <script>
    window.SITE_I18N = {
      en: { page_title: "What's new — Offline Kanban", meta_description: "Offline Kanban update history: new features and fixes.", nav_about: "About", nav_install: "Install", nav_open: "Open", nav_promo: "Promo", nav_source: "Source code", h1: "What's new", lead: 'The same entries as in <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> and <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>. This page is updated on every build.', empty: "No entries yet." },
      ru: { page_title: "Что нового — Offline Kanban", meta_description: "История обновлений Offline Kanban: новые возможности и исправления.", nav_about: "О приложении", nav_install: "Установка", nav_open: "Открыть", nav_promo: "Промо", nav_source: "Исходный код", h1: "Что нового", lead: 'Те же записи, что в <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> и в <a href="https://github.com/ravler1704/kanban-pwa/releases">релизах GitHub</a>. Страница обновляется при каждой сборке.', empty: "Пока нет записей." },
      es: { page_title: "Novedades — Offline Kanban", meta_description: "Historial de actualizaciones de Offline Kanban.", nav_about: "Acerca de", nav_install: "Instalar", nav_open: "Abrir", nav_promo: "Promo", nav_source: "Código fuente", h1: "Novedades", lead: 'Las mismas entradas que en <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> y <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>. Esta página se actualiza en cada compilación.', empty: "Aún no hay entradas." },
      zh: { page_title: "更新内容 — Offline Kanban", meta_description: "Offline Kanban 更新历史：新功能和修复。", nav_about: "关于", nav_install: "安装", nav_open: "打开", nav_promo: "推广页", nav_source: "源代码", h1: "更新内容", lead: '与 <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> 和 <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a> 中的记录相同。此页面在每次构建时更新。', empty: "暂无记录。" },
      hi: { page_title: "नया क्या है — Offline Kanban", meta_description: "Offline Kanban अपडेट इतिहास।", nav_about: "परिचय", nav_install: "इंस्टॉल", nav_open: "खोलें", nav_promo: "प्रोमो", nav_source: "स्रोत कोड", h1: "नया क्या है", lead: 'वही प्रविष्टियाँ जो <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> और <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a> में हैं। यह पेज हर बिल्ड पर अपडेट होता है।', empty: "अभी कोई प्रविष्टि नहीं।" },
      ar: { page_title: "الجديد — Offline Kanban", meta_description: "سجل تحديثات Offline Kanban.", nav_about: "حول", nav_install: "التثبيت", nav_open: "فتح", nav_promo: "الترويج", nav_source: "الشيفرة المصدرية", h1: "الجديد", lead: 'نفس الإدخالات الموجودة في <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> و<a href="https://github.com/ravler1704/kanban-pwa/releases">إصدارات GitHub</a>. يتم تحديث هذه الصفحة مع كل بناء.', empty: "لا توجد إدخالات بعد." },
      pt: { page_title: "Novidades — Offline Kanban", meta_description: "Histórico de atualizações do Offline Kanban.", nav_about: "Sobre", nav_install: "Instalar", nav_open: "Abrir", nav_promo: "Promo", nav_source: "Código-fonte", h1: "Novidades", lead: 'As mesmas entradas do <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> e das <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>. Esta página é atualizada a cada build.', empty: "Ainda não há entradas." },
      fr: { page_title: "Nouveautés — Offline Kanban", meta_description: "Historique des mises à jour d’Offline Kanban.", nav_about: "À propos", nav_install: "Installer", nav_open: "Ouvrir", nav_promo: "Promo", nav_source: "Code source", h1: "Nouveautés", lead: 'Les mêmes entrées que dans le <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> et les <a href="https://github.com/ravler1704/kanban-pwa/releases">versions GitHub</a>. Cette page est mise à jour à chaque build.', empty: "Aucune entrée pour le moment." },
      de: { page_title: "Neuigkeiten — Offline Kanban", meta_description: "Update-Verlauf von Offline Kanban.", nav_about: "Über", nav_install: "Installieren", nav_open: "Öffnen", nav_promo: "Promo", nav_source: "Quellcode", h1: "Neuigkeiten", lead: 'Dieselben Einträge wie im <a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> und in den <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a>. Diese Seite wird bei jedem Build aktualisiert.', empty: "Noch keine Einträge." },
      ja: { page_title: "新着情報 — Offline Kanban", meta_description: "Offline Kanban の更新履歴。", nav_about: "概要", nav_install: "インストール", nav_open: "開く", nav_promo: "プロモ", nav_source: "ソースコード", h1: "新着情報", lead: '<a href="https://github.com/ravler1704/kanban-pwa/blob/master/CHANGELOG.md">CHANGELOG</a> と <a href="https://github.com/ravler1704/kanban-pwa/releases">GitHub Releases</a> と同じ内容です。このページはビルドごとに更新されます。', empty: "まだエントリはありません。" }
    };
  </script>
  <script src="/site-i18n.js"></script>
  <script>
    function formatDates(lang) {
      const map = { en:'en-US', ru:'ru-RU', es:'es-ES', zh:'zh-CN', hi:'hi-IN', ar:'ar', pt:'pt-BR', fr:'fr-FR', de:'de-DE', ja:'ja-JP' };
      const loc = map[lang] || 'en-US';
      document.querySelectorAll('time[data-date]').forEach((el) => {
        const d = new Date(el.getAttribute('data-date') + 'T12:00:00');
        try { el.textContent = d.toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }); } catch { el.textContent = el.getAttribute('data-date'); }
      });
    }
    document.addEventListener('site-lang-change', (e) => formatDates(e.detail.lang));
    formatDates(window.__siteLang || 'en');
  </script>
</body>
</html>`;

writeFileSync(join(publicDir, 'releases.html'), html);
console.log(`releases.html: ${releases.length} releases`);

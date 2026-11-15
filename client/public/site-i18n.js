/* Lightweight i18n for public static pages (promo/install/templates/releases).
   Detects language via localStorage "siteLang" or navigator.languages, applies
   translations from window.SITE_I18N[lang] to [data-i18n] elements, and persists choice. */
(function () {
  const SUPPORTED = ['en', 'ru', 'es', 'zh', 'hi', 'ar', 'pt', 'fr', 'de', 'ja'];
  const RTL = new Set(['ar']);
  const LANG_NAMES = {
    en: 'English', ru: 'Русский', es: 'Español', zh: '中文', hi: 'हिन्दी',
    ar: 'العربية', pt: 'Português', fr: 'Français', de: 'Deutsch', ja: '日本語',
  };
  const storeKey = 'siteLang';

  function normalize(tag) {
    if (!tag) return null;
    const base = String(tag).toLowerCase().split('-')[0];
    return SUPPORTED.includes(base) ? base : null;
  }

  function detect() {
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {}
    const prefs = [...(navigator.languages || []), navigator.language].filter(Boolean);
    for (const p of prefs) {
      const n = normalize(p);
      if (n) return n;
    }
    return 'en';
  }

  function getDict(lang) {
    const all = window.SITE_I18N || {};
    return all[lang] || all.en || {};
  }

  function apply(lang) {
    const dict = getDict(lang);
    const fallback = (window.SITE_I18N && window.SITE_I18N.en) || {};
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = dict[key] != null ? dict[key] : fallback[key];
      if (val == null) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.hasAttribute('placeholder')) el.placeholder = val;
        else el.value = val;
      } else {
        el.textContent = val;
      }
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      const val = dict[key] != null ? dict[key] : fallback[key];
      if (val != null) el.innerHTML = val;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const specs = (el.getAttribute('data-i18n-attr') || '').split(',');
      for (const spec of specs) {
        const [attr, key] = spec.split(':').map((s) => s.trim());
        if (!attr || !key) continue;
        const val = dict[key] != null ? dict[key] : fallback[key];
        if (val != null) el.setAttribute(attr, val);
      }
    });
    // title/meta if provided
    const title = dict.page_title != null ? dict.page_title : fallback.page_title;
    if (title) document.title = title;
    const desc = dict.meta_description != null ? dict.meta_description : fallback.meta_description;
    if (desc) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', desc);
    }
    const sel = document.getElementById('site-lang-select');
    if (sel) sel.value = lang;
    try { localStorage.setItem(storeKey, lang); } catch {}
    window.__siteLang = lang;
    document.dispatchEvent(new CustomEvent('site-lang-change', { detail: { lang } }));
  }

  function createSwitcher() {
    if (document.getElementById('site-lang-select')) return;
    const wrap = document.createElement('div');
    wrap.className = 'lang-switcher';
    wrap.innerHTML = '<label for="site-lang-select" class="sr-only" data-i18n="lang_label">Language</label>' +
      '<select id="site-lang-select" aria-label="Language"></select>';
    const sel = wrap.querySelector('select');
    for (const code of SUPPORTED) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = LANG_NAMES[code] || code;
      sel.appendChild(opt);
    }
    // try to place in top nav
    const nav = document.querySelector('.top nav') || document.querySelector('.top .wrap') || document.body;
    nav.appendChild(wrap);
  }

  function injectStyles() {
    if (document.getElementById('site-i18n-styles')) return;
    const st = document.createElement('style');
    st.id = 'site-i18n-styles';
    st.textContent = `
      .lang-switcher { margin-left: auto; display: inline-flex; align-items: center; }
      .lang-switcher select { background: var(--panel, #1e293b); color: var(--text, #e2e8f0); border: 1px solid var(--border, #334155); border-radius: 8px; padding: 4px 8px; font: inherit; font-size: 0.85rem; cursor: pointer; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
      [dir="rtl"] .lang-switcher { margin-left: 0; margin-right: auto; }
    `;
    document.head.appendChild(st);
  }

  const lang = detect();
  window.__applySiteLang = apply;
  window.__detectSiteLang = detect;
  window.__siteLang = lang;
  // Delegated handler so switching works even if the select is replaced or created later.
  document.addEventListener('change', (e) => {
    const t = e && e.target;
    if (t && t.id === 'site-lang-select') apply(t.value);
  });
  function init() { injectStyles(); createSwitcher(); apply(lang); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
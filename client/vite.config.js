import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apiProxy = { '/api': 'http://localhost:3001' };
const BUILD_ID = Date.now().toString(36);

// version.json (not precached) tells running clients which build the server has.
const buildVersion = {
  name: 'build-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
};

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    buildVersion,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        id: '/',
        name: 'Offline Kanban',
        short_name: 'Kanban',
        description: 'Канбан-доска, работающая без интернета и синхронизирующаяся между устройствами',
        lang: 'ru',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        categories: ['productivity', 'business'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        screenshots: [
          { src: 'screenshots/board.png', sizes: '1360x800', type: 'image/png', form_factor: 'wide', label: 'Доска' },
          { src: 'screenshots/chat.png', sizes: '1360x800', type: 'image/png', form_factor: 'wide', label: 'Чат' },
          { src: 'screenshots/phone.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'На телефоне' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['screenshots/**', 'promo/**'],
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/downloads\//, /^\/\.well-known\//],
        // Board pictures are kept once seen, so the board looks the same offline.
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.startsWith('/backgrounds/') || url.pathname.startsWith('/api/backgrounds/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'board-backgrounds',
            expiration: { maxEntries: 60 },
            cacheableResponse: { statuses: [200] },
          },
        }],
      },
      devOptions: {
        enabled: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});

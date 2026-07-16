// service-worker.js — v0.5.0 PWA cache
const CACHE_NAME = 'lsk-cache-v0.5.0';

const APP_SHELL = [
  './',
  './popup/popup.html',
  './popup/popup.css',
  './popup/popup.js',
  './lib/storage.js',
  './lib/breakdown.js',
  './lib/celebrate.js',
  './lib/step_timer.js',
  './lib/pets.js',
  './lib/calendar.js',
  './lib/user.js',
  './lib/auth.js',
  './lib/team.js',
  './lib/ai_rerank.js',
  './lib/llm_client.js',
  './lib/providers.js',
  './lib/user_id.js',
  './lib/layout.js',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-48.png',
  './icons/icon-128.png',
  './icons/icon-256.png',
  './icons/mascot.png',
  './options/options.html',
  './options/options.css',
  './options/options.js',
  './index.html',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Pass-through for cross-origin and extension-internal URLs
  if (url.origin !== self.location.origin) return;
  if (url.protocol === 'chrome-extension:') return;

  // Network-first for API-like requests (POST, or paths containing /v1/, /api/)
  if (event.request.method !== 'GET' || /\/(v1|api)\//i.test(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Stale-while-revalidate for app shell
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetched = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => cached);
        return cached || fetched;
      })
    )
  );
});

/**
 * Purin Cycle — Cache-First Offline Service Worker (Phase 4)
 * Uses relative ./ paths for localhost and GitHub Pages subpath compatibility.
 */

const CACHE_NAME = 'purin-cycle-v3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/soundEngine.js',
  './js/predictionEngine.js',
  './js/floImporter.js',
  './js/vaultCrypto.js',
  './assets/fonts/Nunito-Medium.woff2',
  './assets/fonts/Nunito-SemiBold.woff2',
  './assets/fonts/Nunito-Bold.woff2',
  './assets/fonts/Nunito-ExtraBold.woff2',
  './assets/icons/pompom/pompom_waving.png',
  './assets/icons/pompom/pompom_sleeping.png',
  './assets/icons/pompom/pompom_energetic.png',
  './assets/icons/pompom/pompom_love.png',
  './assets/icons/pompom/pompom_eating.png',
  './assets/icons/pwa/apple-touch-icon.png',
  './assets/icons/pwa/icon-192.png',
  './assets/icons/pwa/icon-512.png',
  './assets/icons/pwa/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            const response = await fetch(url, { cache: 'reload' });
            if (response && response.ok) {
              await cache.put(url, response);
            }
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('purin-cycle-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});

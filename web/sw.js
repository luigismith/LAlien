/**
 * sw.js -- Service Worker for offline support
 * Cache-first strategy for static assets
 */

const CACHE_NAME = 'lalien-companion-v6';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/engine/events.js',
    './js/engine/game-loop.js',
    './js/engine/persistence.js',
    './js/pet/pet.js',
    './js/pet/needs.js',
    './js/pet/evolution.js',
    './js/pet/death.js',
    './js/pet/minigames.js',
    './js/ai/llm-client.js',
    './js/ai/system-prompt.js',
    './js/ai/stt-client.js',
    './js/ai/diary-generator.js',
    './js/ui/renderer.js',
    './js/ui/screens.js',
    './js/ui/speech-bubble.js',
    './js/ui/status-bar.js',
    './js/ui/interactions.js',
    './js/ui/gestures.js',
    './js/ui/tutorial.js',
    './js/ui/notifications.js',
    './js/pet/activity.js',
    './js/pet/autonomy.js',
    './js/pet/rhythms.js',
    './js/ai/sentiment.js',
    './js/audio/sound-engine.js',
    './js/engine/cloud-sync.js',
    './js/i18n/i18n.js',
    './js/i18n/alien-lexicon.js',
    './manifest.json',
    './lang/it.json',
    './lang/en.json',
    './lang/es.json',
    './lang/fr.json',
    './lang/de.json',
    './lang/alien.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        })
    );
    self.clients.claim();
});

// Fetch strategy:
// - API calls: network-only (never cache, 503 on offline)
// - JS / CSS / HTML: network-first with cache fallback (so deploys take effect IMMEDIATELY;
//   only fall back to cache when offline). This prevents stale-code bugs after deploy.
// - Everything else (images, fonts, lang/): cache-first for speed.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    if (url.pathname.startsWith('/api/') ||
        url.hostname.includes('api.anthropic.com') ||
        url.hostname.includes('api.openai.com')) {
        event.respondWith(fetch(event.request).catch(() => new Response('offline', { status: 503 })));
        return;
    }

    const isCode = /\.(js|mjs|css|html|map)$/i.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/index.html');

    if (isCode) {
        // Network-first: try network, fall back to cache if offline. Always refresh cache.
        event.respondWith(
            fetch(event.request).then((response) => {
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
                }
                return response;
            }).catch(() => caches.match(event.request).then((cached) => cached || new Response('offline', { status: 503 })))
        );
        return;
    }

    // Cache-first for images, lang packs, manifests, icons, etc.
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
                }
                return response;
            }).catch(() => cached);
        })
    );
});

// Tap on a notification: focus or open the app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
            for (const w of wins) {
                if ('focus' in w) return w.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./');
        })
    );
});

// Bridge: main page can ask the SW to display a native notification.
// On iOS, only SW-triggered notifications are reliable inside an installed PWA.
self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SHOW_NOTIFICATION' && data.title) {
        const opts = Object.assign({
            body: '',
            icon: './icon-192.svg',
            badge: './icon-192.svg',
            tag: 'lalien',
        }, data.options || {});
        self.registration.showNotification(data.title, opts);
    }
});

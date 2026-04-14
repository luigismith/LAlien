/**
 * sw.js -- Service Worker for offline support
 * Cache-first strategy for static assets
 */

const CACHE_NAME = 'lalien-companion-v1';
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

// Fetch: cache-first for static assets, network-first for API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API calls (LLM, STT) always go to network
    if (url.hostname.includes('api.anthropic.com') ||
        url.hostname.includes('api.openai.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first for everything else
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // Cache successful responses
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            });
        })
    );
});

const CACHE_NAME = 'readit-offline-v3';

const LOCAL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js'
];

const CDN_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// 1. Install: Fault-tolerant caching so one CDN hiccup never breaks offline mode
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Cache local core files first
            for (const url of LOCAL_ASSETS) {
                try {
                    const res = await fetch(url, { cache: 'reload' });
                    if (res.ok) await cache.put(url, res);
                } catch (e) {}
            }
            // Cache external CDNs individually with no-cors fallback
            for (const url of CDN_ASSETS) {
                try {
                    const req = new Request(url, { mode: 'cors' });
                    const res = await fetch(req);
                    if (res.ok) await cache.put(url, res);
                } catch (err) {
                    try {
                        const opaqueRes = await fetch(new Request(url, { mode: 'no-cors' }));
                        await cache.put(url, opaqueRes);
                    } catch (e) {}
                }
            }
        })
    );
});

// 2. Activate: Clean up old caches and take immediate control
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// 3. Fetch: Smart routing for Offline Navigation, Local Assets, and CDNs
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const req = event.request;
    const url = new URL(req.url);

    // A. Handle Page Navigation (Opening the app offline)
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((netRes) => {
                    const clone = netRes.clone();
                    caches.open(CACHE_NAME).then(c => c.put('./index.html', clone));
                    return netRes;
                })
                .catch(async () => {
                    const cache = await caches.open(CACHE_NAME);
                    return (await cache.match('./index.html')) ||
                           (await cache.match('./')) ||
                           (await cache.match('index.html'));
                })
        );
        return;
    }

    // B. Handle Local App Files (style.css, script.js) -> Network-First with IgnoreSearch fallback
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req)
                .then((netRes) => {
                    if (netRes && netRes.status === 200) {
                        const clone = netRes.clone();
                        caches.open(CACHE_NAME).then(c => c.put(req, clone));
                    }
                    return netRes;
                })
                .catch(async () => {
                    const cache = await caches.open(CACHE_NAME);
                    return (await cache.match(req, { ignoreSearch: true })) ||
                           (await cache.match(url.pathname, { ignoreSearch: true }));
                })
        );
        return;
    }

    // C. Handle External CDN Libraries (Tailwind, PDF.js, Fonts) -> Cache-First
    event.respondWith(
        caches.match(req, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((netRes) => {
                if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                    const clone = netRes.clone();
                    caches.open(CACHE_NAME).then(c => c.put(req, clone));
                }
                return netRes;
            });
        })
    );
});

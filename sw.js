const CACHE_NAME = 'readit-offline-core-v5';

const CORE_LOCAL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js'
];

const EXTERNAL_CDN_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            for (const url of CORE_LOCAL_ASSETS) {
                try {
                    const response = await fetch(url, { cache: 'reload' });
                    if (response && response.status === 200) {
                        await cache.put(url, response.clone());
                    }
                } catch (e) {}
            }

            for (const url of EXTERNAL_CDN_ASSETS) {
                try {
                    const corsReq = new Request(url, { mode: 'cors' });
                    const response = await fetch(corsReq);
                    if (response && response.status === 200) {
                        await cache.put(url, response.clone());
                    }
                } catch (err) {
                    try {
                        const noCorsReq = new Request(url, { mode: 'no-cors' });
                        const opaqueRes = await fetch(noCorsReq);
                        if (opaqueRes) await cache.put(url, opaqueRes);
                    } catch (e) {}
                }
            }
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const req = event.request;
    const url = new URL(req.url);

    if (url.protocol === 'blob:' || url.protocol === 'data:') return;

    // 1. Navigation Requests: Instant Offline Shell + Background Update
    if (req.mode === 'navigate') {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                const cachedIndex =
                    (await cache.match('./index.html')) ||
                    (await cache.match('./')) ||
                    (await cache.match('index.html'));

                const networkFetch = fetch(req)
                    .then((netRes) => {
                        if (netRes && netRes.status === 200) {
                            cache.put('./index.html', netRes.clone());
                        }
                        return netRes;
                    })
                    .catch(() => null);

                if (cachedIndex) {
                    event.waitUntil(networkFetch);
                    return cachedIndex;
                }

                const netResult = await networkFetch;
                if (netResult) return netResult;

                return new Response(
                    '<!DOCTYPE html><html><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px;"><h2>ReadIT Offline</h2><p>Please open the app once with internet enabled to finish offline setup.</p></body></html>',
                    { headers: { 'Content-Type': 'text/html' } }
                );
            })()
        );
        return;
    }

    // 2. Local App Files (style.css, script.js): Cache-First for Instant Offline + Background Sync
    if (url.origin === self.location.origin) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                const cachedFile =
                    (await cache.match(req, { ignoreSearch: true })) ||
                    (await cache.match(url.pathname, { ignoreSearch: true }));

                const networkUpdate = fetch(req)
                    .then((netRes) => {
                        if (netRes && netRes.status === 200) {
                            cache.put(req, netRes.clone());
                        }
                        return netRes;
                    })
                    .catch(() => null);

                if (cachedFile) {
                    event.waitUntil(networkUpdate);
                    return cachedFile;
                }

                const netRes = await networkUpdate;
                return netRes || new Response('', { status: 404 });
            })()
        );
        return;
    }

    // 3. External CDNs (PDF.js, Tailwind, Fonts): Strict Cache-First
    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const cachedCdn =
                (await cache.match(req, { ignoreSearch: true })) ||
                (await cache.match(req.url));

            if (cachedCdn) return cachedCdn;

            try {
                const netRes = await fetch(req);
                if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                    cache.put(req, netRes.clone());
                }
                return netRes;
            } catch (e) {
                return new Response('', { status: 200 });
            }
        })()
    );
});

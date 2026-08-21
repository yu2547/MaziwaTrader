// Comprehensive Service Worker for Deriv Bot Offline Functionality
//
// Renaming this discards everything the previous worker stored, because the
// activate handler deletes every cache whose name does not match. v3 exists to
// purge a poisoned v2: see PRECACHE_URLS below.
const CACHE_NAME = 'deriv-bot-v3';
const OFFLINE_URL = '/offline.html';

// The worker narrates every request it sees, which on a normal load is dozens
// of lines and is what the application's own logging has to compete with. A
// service worker has no localStorage, so unlike the app side this cannot be
// toggled at runtime - flip it here and redeploy when the worker itself is
// what needs watching. Warnings and errors below are deliberately left alone.
const DEBUG = false;
const debug = (...args) => {
    if (DEBUG) console.log(...args);
};

// Files to cache immediately on install.
//
// The app shell - '/' and '/index.html' - is deliberately NOT here, and must
// never be added back. Script filenames carry a content hash, so the shell is
// the one document that names the current build. Caching it under a name that
// does not change per deploy froze users on whatever build they first
// installed: the cached HTML kept asking for the old hashed chunks, the worker
// passes .js straight through, and the server still had those files, so the
// stale app loaded perfectly and silently. Every fix shipped after that first
// install was invisible to anyone holding this cache.
//
// Only genuinely build-independent files belong here.
const PRECACHE_URLS = ['/offline.html', '/manifest.json', '/deriv-logo.svg'];

debug('[SW] Service worker script loaded');

// Install event - cache essential files
self.addEventListener('install', event => {
    debug('[SW] Installing service worker...');

    event.waitUntil(
        (async () => {
            try {
                const cache = await caches.open(CACHE_NAME);
                debug('[SW] Caching precache URLs');

                // Cache essential files
                await cache.addAll(PRECACHE_URLS);
                debug('[SW] Precache URLs cached successfully');

                // Force activation
                await self.skipWaiting();
                debug('[SW] Service worker installed and skipping waiting');
            } catch (error) {
                console.error('[SW] Install failed:', error);
                // Still skip waiting even if caching fails
                await self.skipWaiting();
            }
        })()
    );
});

// Activate event - clean up and take control
self.addEventListener('activate', event => {
    debug('[SW] Activating service worker...');

    event.waitUntil(
        (async () => {
            try {
                // Clean up old caches
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            debug('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );

                // Take control of all clients
                await self.clients.claim();
                debug('[SW] Service worker activated and claimed clients');

                // Notify all clients that SW is ready
                const clients = await self.clients.matchAll();
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        message: 'Service worker is ready for offline functionality',
                    });
                });
            } catch (error) {
                console.error('[SW] Activation failed:', error);
            }
        })()
    );
});

// Fetch event - handle all network requests
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip chrome-extension and other non-http requests
    if (!request.url.startsWith('http')) {
        return;
    }

    // Skip anything not served by this origin.
    //
    // Third-party assets are not ours to cache, and under this app's Content
    // Security Policy the worker cannot even fetch most of them: a request it
    // makes here is governed by connect-src, which does not list the font and
    // analytics hosts that font-src and img-src do allow the page itself to
    // use. Google Fonts was the worst of it - the pathname ends in .woff2, so
    // it routed to handleStaticAsset, whose fetch was refused, which threw,
    // which fell through to the offline fallback, and every font request
    // produced four console errors. Several hundred of them buried the
    // application's own logging.
    //
    // Letting these go straight to the network is also simply correct: the
    // browser caches them perfectly well on its own.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Skip JavaScript chunks and CSS to prevent chunk loading errors
    if (
        url.pathname.includes('.js') ||
        url.pathname.includes('.css') ||
        url.pathname.includes('/static/js/') ||
        url.pathname.includes('/static/css/') ||
        url.pathname.includes('chunk') ||
        url.pathname.includes('.mjs')
    ) {
        debug('[SW] Skipping JS/CSS chunk:', url.pathname);
        return;
    }

    // Skip Range requests entirely - media elements fetch audio and video
    // this way, and the server answers 206 Partial Content. The Cache API
    // refuses to store a partial response: cache.put() throws, the perfectly
    // good 206 was thrown away with it, and the offline fallback handed the
    // <audio> element a fabricated 503 - which is where every "NotSupported-
    // Error: The element has no supported sources" came from. The browser
    // handles range caching natively; the worker has no business in between.
    if (request.headers.has('range')) {
        return;
    }

    // Skip authentication requests
    if (isAuthRequest(url)) {
        debug('[SW] Skipping auth request:', url.pathname);
        return;
    }

    // Skip API requests to prevent interference
    if (isApiRequest(url)) {
        debug('[SW] Skipping API request:', url.pathname);
        return;
    }

    // Skip the public exchange-rate API used by the header's currency
    // selector - letting the SW "handle" it here means any transient
    // network hiccup gets silently replaced with a synthetic offline
    // response instead of a real failure the app can react to.
    if (url.hostname === 'open.er-api.com') {
        debug('[SW] Skipping exchange-rate request:', url.pathname);
        return;
    }

    // Skip requests with no-cache headers
    if (request.headers.get('cache-control') === 'no-cache') {
        return;
    }

    // Skip requests with authentication headers
    if (request.headers.get('authorization') || request.headers.get('x-auth-token')) {
        return;
    }

    event.respondWith(handleRequest(request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    debug('[SW] Handling request:', pathname);

    try {
        // Handle different types of requests
        if (isNavigationRequest(request)) {
            return await handleNavigation(request);
        } else if (isStaticAsset(pathname)) {
            return await handleStaticAsset(request);
        } else if (isApiRequest(url)) {
            return await handleApiRequest(request);
        } else {
            return await handleGenericRequest(request);
        }
    } catch (error) {
        console.error('[SW] Request handling failed:', error);
        return await handleOfflineFallback(request);
    }
}

// Store a response in the cache without ever being the reason a request
// fails. Only a full 200 is cacheable - `response.ok` is true for the whole
// 2xx range, and passing a 206 to cache.put() does not store nothing, it
// throws, which used to unwind a handler that was already holding a good
// response. A cache write failing for any other reason (quota, eviction
// race) is equally not the caller's problem.
async function cacheSafely(request, response) {
    if (response.status !== 200) return;
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
    } catch (error) {
        debug('[SW] Cache write failed (response still served):', error);
    }
}

// Handle navigation requests (HTML pages)
async function handleNavigation(request) {
    try {
        debug('[SW] Handling navigation request');

        // Network only, and deliberately not cached. The shell names the
        // current build's hashed chunks, so a stored copy goes stale the next
        // time anything ships and pins whoever holds it to a dead build. A
        // reachable network is the only source that can answer this correctly.
        return await fetch(request);
    } catch (error) {
        debug('[SW] Network failed for navigation, serving offline page');

        // Genuinely offline. The offline page is build-independent, so it is
        // safe to serve from cache - unlike the app shell, which is not.
        const offlineResponse = await caches.match(OFFLINE_URL);
        if (offlineResponse) {
            return offlineResponse;
        }

        throw error;
    }
}

// Handle static assets (JS, CSS, images, fonts)
async function handleStaticAsset(request) {
    try {
        debug('[SW] Handling static asset:', request.url);

        // Check cache first for static assets
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            debug('[SW] Serving static asset from cache');
            return cachedResponse;
        }

        // Try network
        const networkResponse = await fetch(request);

        await cacheSafely(request, networkResponse);

        return networkResponse;
    } catch (error) {
        debug('[SW] Static asset failed:', error);

        // Try cache again as fallback
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        throw error;
    }
}

// Handle API requests
async function handleApiRequest(request) {
    try {
        debug('[SW] Handling API request:', request.url);

        // Always try network first for API requests
        const networkResponse = await fetch(request, { timeout: 5000 });
        return networkResponse;
    } catch (error) {
        debug('[SW] API request failed, returning offline response');

        // Return structured offline response for API failures
        return new Response(
            JSON.stringify({
                error: 'Offline',
                message: 'API not available offline',
                offline: true,
                timestamp: new Date().toISOString(),
                url: request.url,
            }),
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Offline-Mode': 'true',
                },
            }
        );
    }
}

// Handle generic requests
async function handleGenericRequest(request) {
    try {
        debug('[SW] Handling generic request:', request.url);

        // Try network first
        const networkResponse = await fetch(request);

        await cacheSafely(request, networkResponse);

        return networkResponse;
    } catch (error) {
        // Try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        throw error;
    }
}

// Handle offline fallbacks
async function handleOfflineFallback(request) {
    debug('[SW] Providing offline fallback for:', request.url);

    // For HTML requests, serve the offline page. It deliberately does not fall
    // back to a cached app shell first - see PRECACHE_URLS for why serving a
    // stored shell is worse than showing an honest offline page.
    if (request.headers.get('accept')?.includes('text/html')) {
        const offlineResponse = await caches.match(OFFLINE_URL);
        if (offlineResponse) {
            return offlineResponse;
        }

        // Create basic offline HTML response
        return new Response(
            `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Offline - Deriv Bot</title>
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: #0e0e0e; 
                        color: #ffffff; 
                        margin: 0;
                        padding: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                    }
                    .container { 
                        text-align: center; 
                        max-width: 500px; 
                        padding: 40px 20px;
                    }
                    h1 { 
                        color: #ff444f; 
                        font-size: 2.5rem;
                        margin-bottom: 1rem;
                    }
                    p { 
                        font-size: 1.1rem; 
                        line-height: 1.6;
                        margin-bottom: 2rem;
                        opacity: 0.9;
                    }
                    button { 
                        background: #ff444f; 
                        color: white; 
                        border: none; 
                        padding: 15px 30px; 
                        border-radius: 8px; 
                        cursor: pointer; 
                        font-size: 16px; 
                        font-weight: 600;
                        transition: background-color 0.2s;
                    }
                    button:hover {
                        background: #e63946;
                    }
                    .status {
                        margin-top: 2rem;
                        padding: 15px;
                        background: rgba(255, 68, 79, 0.1);
                        border-radius: 8px;
                        border-left: 4px solid #ff444f;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>You're Offline</h1>
                    <p>Deriv Bot requires an internet connection to function properly. Please check your connection and try again.</p>
                    <button onclick="window.location.reload()">Try Again</button>
                    <div class="status">
                        <strong>Connection Status:</strong> <span id="status">Offline</span>
                    </div>
                </div>
                <script>
                    function updateStatus() {
                        document.getElementById('status').textContent = navigator.onLine ? 'Online' : 'Offline';
                    }
                    
                    window.addEventListener('online', () => {
                        updateStatus();
                        setTimeout(() => window.location.reload(), 1000);
                    });
                    
                    window.addEventListener('offline', updateStatus);
                    updateStatus();
                </script>
            </body>
            </html>
        `,
            {
                status: 200,
                headers: {
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-cache',
                },
            }
        );
    }

    // For other requests, return generic offline response
    return new Response(
        JSON.stringify({
            error: 'Offline',
            message: 'Content not available offline',
            url: request.url,
            timestamp: new Date().toISOString(),
        }),
        {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
                'Content-Type': 'application/json',
                'X-Offline-Mode': 'true',
            },
        }
    );
}

// Helper functions
function isNavigationRequest(request) {
    return (
        request.mode === 'navigate' ||
        (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
    );
}

function isStaticAsset(pathname) {
    return (
        /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|avif)$/i.test(pathname) ||
        pathname.startsWith('/assets/') ||
        pathname.startsWith('/static/') ||
        pathname.startsWith('/_assets/')
    );
}

// [AI]
function isAuthRequest(url) {
    // Helper function to check if hostname is allowed domain or subdomain
    function isAllowedDomain(hostname, allowedDomain) {
        return hostname === allowedDomain || hostname.endsWith('.' + allowedDomain);
    }

    // Skip all authentication-related requests
    return (
        // OAuth/OIDC endpoints
        url.pathname.includes('/oauth') ||
        url.pathname.includes('/auth') ||
        url.pathname.includes('/login') ||
        url.pathname.includes('/logout') ||
        url.pathname.includes('/token') ||
        url.pathname.includes('/authorize') ||
        url.pathname.includes('/callback') ||
        // Deriv-specific auth endpoints (using secure domain validation)
        isAllowedDomain(url.hostname, 'oauth.deriv.com') ||
        isAllowedDomain(url.hostname, 'auth.deriv.com') ||
        isAllowedDomain(url.hostname, 'accounts.deriv.com') ||
        // Third-party auth providers (using secure domain validation)
        isAllowedDomain(url.hostname, 'google.com') ||
        isAllowedDomain(url.hostname, 'googleapis.com') ||
        isAllowedDomain(url.hostname, 'facebook.com') ||
        isAllowedDomain(url.hostname, 'apple.com') ||
        isAllowedDomain(url.hostname, 'microsoft.com') ||
        isAllowedDomain(url.hostname, 'live.com') ||
        // Auth-related query parameters
        url.search.includes('code=') ||
        url.search.includes('state=') ||
        url.search.includes('token=') ||
        url.search.includes('access_token=') ||
        url.search.includes('id_token=')
    );
}
// [/AI]

// [AI]
function isApiRequest(url) {
    // Helper function to check if hostname is allowed domain or subdomain
    function isAllowedDomain(hostname, allowedDomain) {
        return hostname === allowedDomain || hostname.endsWith('.' + allowedDomain);
    }

    return (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/v1/') ||
        url.pathname.startsWith('/v2/') ||
        isAllowedDomain(url.hostname, 'deriv.com') ||
        isAllowedDomain(url.hostname, 'deriv.me') ||
        isAllowedDomain(url.hostname, 'binary.com') ||
        url.hostname.startsWith('api.') ||
        // WebSocket connections
        url.protocol === 'ws:' ||
        url.protocol === 'wss:' ||
        // Real-time data endpoints
        url.hostname.startsWith('ws.') ||
        url.hostname.includes('websocket') ||
        // Analytics and tracking (let them fail naturally rather than cache)
        url.hostname.includes('analytics') ||
        url.hostname.includes('tracking') ||
        url.hostname.includes('metrics')
    );
}
// [/AI]

// Handle messages from main thread
self.addEventListener('message', event => {
    const { type, data } = event.data || {};

    debug('[SW] Received message:', type, data);

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
        case 'GET_CACHE_STATUS':
            getCacheStatus().then(status => {
                event.ports[0]?.postMessage({ type: 'CACHE_STATUS', data: status });
            });
            break;
        case 'CLEAR_CACHE':
            clearCache().then(() => {
                event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
            });
            break;
    }
});

// Get cache status
async function getCacheStatus() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        return {
            cacheName: CACHE_NAME,
            cachedUrls: keys.map(request => request.url),
            cacheSize: keys.length,
        };
    } catch (error) {
        console.error('[SW] Failed to get cache status:', error);
        return { error: error.message };
    }
}

// Clear cache
async function clearCache() {
    try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        debug('[SW] All caches cleared');
    } catch (error) {
        console.error('[SW] Failed to clear cache:', error);
    }
}

debug('[SW] Service worker setup complete');

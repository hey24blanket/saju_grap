const CACHE_NAME = 'sajugrap-shell-v3-20261015b';
const SHELL = ['/', '/index.html', '/app.js?v=20261015b', '/styles/app.css?v=20261015b', '/lib/waveReading.js', '/lib/browserAccount.js', '/lib/firebasePublicConfig.js', '/styles/tokens.css?v=20261015', '/manifest.webmanifest', '/icons/sajugrap.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sajugrap-shell-') && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // No API, profile, admin, or unrelated application response enters this cache.
  if (!SHELL.includes(url.pathname + url.search) && url.pathname !== '/') return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(c => c.put(request, copy)); }
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? caches.match('/index.html') : Response.error())));
});

// Service worker: deja abrir la app sin señal en el campo.
// La app (index.html, js/calc.js, íconos) se pide primero a la red para tener siempre la última versión y, si no hay señal, sale de la copia.
// Las librerías (PDF) y tipografías se sirven de la copia. Los datos (/api/) nunca se guardan aquí: de eso se encarga la app.
const CACHE = 'bs-app-v1';
const SHELL = ['/', '/index.html', '/js/calc.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  const keep = res => { if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; };
  if (u.origin === self.location.origin) {
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/index.html'))));
    return;
  }
  if (/(^|\.)cdnjs\.cloudflare\.com$|(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(keep)));
  }
});

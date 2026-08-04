/* ---------------------------------------------------------------
   Cense service worker — an RNE Holdings product

   Makes the installed app work with no network at all. It caches only
   Cense's own files; it never sees, stores or transmits a budget. The
   data still lives in localStorage on the device, exactly as before.

   IF YOU EDIT ANY APP FILE, BUMP `CACHE`. Otherwise an installed copy
   keeps serving the old version until it happens to revalidate.
   --------------------------------------------------------------- */

var CACHE = 'cense-v7';   /* v7: self-hosted typefaces */

var ASSETS = [
  './',
  './index.html',
  './landing.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  /* If these are missing here the installed app renders in system-ui offline
     forever, and it will look correct on a machine that has them cached. */
  './fonts/archivo-latin.woff2',
  './fonts/plexmono-600-latin.woff2',
  './favicon-32.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      /* Individually, so one missing optional file cannot fail the whole
         install and leave the app with no offline copy at all. */
      .then(function (c) {
        return Promise.all(ASSETS.map(function (url) {
          return c.add(url).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Stale-while-revalidate: the cached copy answers immediately so the app
   opens instantly and works on a plane, while a fresh copy is fetched in
   the background for next launch. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   /* never touch third parties */

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () {
        /* Offline. A navigation still needs something to render. */
        return hit || caches.match('./index.html');
      });

      return hit || net;
    })
  );
});

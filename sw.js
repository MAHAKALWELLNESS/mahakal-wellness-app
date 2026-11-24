// Service worker - required by browsers to show the "Install app" prompt, handles incoming push
// notifications, and shows a small "Can't connect right now" page (offline.html) when a PAGE cannot be
// loaded because the phone has no internet or the server answers with an error (404 / 5xx).
// The Android (Play Store) app needs this: a page that cannot be loaded must still answer with a normal page.
// This app is fully live-data-driven (Supabase), so it does NOT cache pages or data - the only things kept on the phone
// are offline.html itself and ONE page: the product calculator (calculator.html), which has to work with no internet.
// Every other request is passed straight through to the network.
// (If offline.html is ever changed, change the version in OFFLINE_CACHE too, so phones pick up the new one.)
const OFFLINE_CACHE = 'mw-offline-v1';
// The product calculator: online it is always fetched from the server (and the newest copy is saved); with no internet, a server
// error, or a connection so slow that nothing has come back after CALC_WAIT_MS, the saved copy opens instead.
// The page saves itself here the first time it is opened (calculator.html uses the same cache name), and keeps its price list on its own.
const CALC_CACHE = 'mw-calc-v1';
const CALC_WAIT_MS = 4000;
const OFFLINE_URL = 'offline.html';
const OFFLINE_FALLBACK_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No connection</title></head>' +
  '<body style="margin:0;font-family:system-ui,sans-serif;background:#F6F5F1;color:#1d2b26;text-align:center;padding:48px 20px">' +
  '<h1 style="color:#132E26;font-size:22px">Can\'t connect right now</h1><p>Please check your internet connection and try again.</p>' +
  '<p><button onclick="location.reload()" style="font:inherit;font-weight:700;padding:12px 24px;border:0;border-radius:12px;background:#132E26;color:#fff">Try again</button></p></body></html>';

function offlineResponse_() {
  return caches.match(OFFLINE_URL).then(function (hit) {
    return hit || new Response(OFFLINE_FALLBACK_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }).catch(function () {
    return new Response(OFFLINE_FALLBACK_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
}

function calcUrl_() { return new URL('calculator.html', self.registration.scope).href; }
function isCalcPage_(url) { return new URL(url).pathname === new URL(calcUrl_()).pathname; }
function savedCalc_() {                                              // (caches.match with a cache name never creates an empty cache, caches.open would)
  return caches.match(calcUrl_(), { cacheName: CALC_CACHE }).catch(function () { return null; });
}
function calcOrOffline_() {
  return savedCalc_().then(function (hit) { return hit || offlineResponse_(); });
}
function calcResponse_(event) {
  const net = fetch(event.request).then(function (res) {
    if (res && res.status === 200 && res.type === 'basic') {          // the newest copy is kept for the next time there is no internet
      const copy = res.clone();
      return caches.open(CALC_CACHE).then(function (c) { return c.put(calcUrl_(), copy); }).catch(function () { /* not saved this time */ }).then(function () { return res; });
    }
    return res;
  });
  event.waitUntil(net.catch(function () { /* offline: nothing to save */ }));   // the worker stays alive until the newest copy is saved, also when the saved one was shown first
  return new Promise(function (resolve) {
    let done = false;
    function finish(r) { if (!done) { done = true; resolve(r); } }
    net.then(function (res) {
      if (res && (res.status === 404 || (res.status >= 500 && res.status <= 599))) return calcOrOffline_().then(finish);
      finish(res);
    }).catch(function () { calcOrOffline_().then(finish); });
    setTimeout(function () { savedCalc_().then(function (hit) { if (hit) finish(hit); }); }, CALC_WAIT_MS);   // a very slow connection: do not keep the phone waiting when a saved copy exists
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then(function (cache) { return cache.add(new Request(OFFLINE_URL, { cache: 'reload' })); })
      .catch(function () { /* could not keep the offline page now - the app still works, a built-in copy is used instead */ })
      .then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return (k.indexOf('mw-offline-') === 0 && k !== OFFLINE_CACHE) || (k.indexOf('mw-calc-') === 0 && k !== CALC_CACHE); })
          .map(function (k) { return caches.delete(k); }));
      })
      .catch(function () { /* nothing to clean */ })
      .then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (event) {
  const req = event.request;
  // only a PAGE being opened gets the offline page; pictures, data and scripts are passed through unchanged
  if (req.mode !== 'navigate' || new URL(req.url).pathname.indexOf('/.well-known/') !== -1) {
    event.respondWith(fetch(req));
    return;
  }
  if (isCalcPage_(req.url)) { event.respondWith(calcResponse_(event)); return; }       // the product calculator: also opens with no internet
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && (res.status === 404 || (res.status >= 500 && res.status <= 599))) return offlineResponse_();
      return res;
    }).catch(function () { return offlineResponse_(); })
  );
});

self.addEventListener('push', function (event) {
  let data = { title: 'Mahakal Wellness', body: 'You have a new update.' };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Mahakal Wellness', {
      body: data.body || '',
      icon: new URL('icon-192.png', self.registration.scope).href,
      badge: new URL('badge-96.png', self.registration.scope).href
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(new URL('order.html', self.registration.scope).href);
    })
  );
});

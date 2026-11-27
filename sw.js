// Service worker of the Mahakal Wellness app.
//  1. The app's own files (pages, the database library, the fonts, the icons) are kept ON THE PHONE, so a page opens at once when the internet is
//     slow and also when there is no internet at all. The data itself (prices, bills, stock ...) is never kept here: it always comes live from Supabase.
//  2. A page is asked from the server first. When the whole answer has not arrived after PAGE_WAIT_MS (a slow connection) or cannot arrive (no internet,
//     a server error), the saved copy opens instead, and the late answer is still saved for the next time. A page that was never saved and cannot be
//     loaded shows offline.html ("Can't connect right now") - never a frozen white screen.
//  3. Shows incoming push notifications (the Android / Play Store app and the installed app need this worker).
// Everything that is not a file of this app (the database, pictures of other sites, saving something) is NOT touched: it goes straight to the network.
// (If offline.html or one of the lists of files below is changed, change VERSION too, so every phone picks the new files up.
//  If the saved pages ever have to be thrown away on every phone, change SHELL_CACHE to a new name: the old one is deleted when the worker starts.)
const VERSION = '4';
const OFFLINE_CACHE = 'mw-offline-v1';
// the app's own pages + libraries + fonts + icons: only added to / renewed (a page is renewed every time it is opened with internet)
const SHELL_CACHE = 'mw-shell-v1';
// The product calculator: online it is always fetched from the server (and the newest copy is saved); with no internet, a server
// error, or a connection so slow that nothing has come back after CALC_WAIT_MS, the saved copy opens instead.
// The page saves itself here the first time it is opened (calculator.html uses the same cache name), and keeps its price list on its own.
const CALC_CACHE = 'mw-calc-v1';
const CALC_WAIT_MS = 4000;
// Any other page: the newest page when all of it arrives within PAGE_WAIT_MS, else the saved copy. A page that was never saved is waited for up to PAGE_GIVE_UP_MS.
const PAGE_WAIT_MS = 1800;
const PAGE_GIVE_UP_MS = 25000;
const FILE_GIVE_UP_MS = 20000;
const OFFLINE_URL = 'offline.html';
// saved when the worker is installed (small, and needed by every page): the main page, the database library, the fonts
const CORE_FILES = ['index.html', 'vendor/supabase-2.119.2.js', 'vendor/fonts/inter-latin-wght-normal.woff2', 'vendor/fonts/inter-latin-ext-wght-normal.woff2', 'vendor/fonts/fraunces-latin-wght-normal.woff2'];
// saved one after the other in the background, once the first page has loaded (a page sends 'mw-warm'): so the whole app also opens with no internet.
// '' is the app's start address (the server shows home.html there)
const WARM_FILES = ['', 'order.html', 'products.html', 'account.html', 'sp-set.html', 'calculator.html', 'hall-booking.html', 'bill.html', 'home.html', 'install.html',
  'manifest-main.json', 'manifest-order.json', 'manifest-calc.json', 'icon-192.png', 'icon-512.png', 'badge-96.png'];
const OFFLINE_FALLBACK_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No connection</title></head>' +
  '<body style="margin:0;font-family:system-ui,sans-serif;background:#F6F5F1;color:#1d2b26;text-align:center;padding:48px 20px">' +
  '<h1 style="color:#132E26;font-size:22px">Can\'t connect right now</h1><p>Please check your internet connection and try again.</p>' +
  '<p><button onclick="location.reload()" style="font:inherit;font-weight:700;padding:12px 24px;border:0;border-radius:12px;background:#132E26;color:#fff">Try again</button></p></body></html>';

function noop_() { /* nothing to do */ }
function rel_(path) { return new URL(path, self.registration.scope).href; }
function offlineResponse_() {
  return caches.match(OFFLINE_URL).then(function (hit) {
    return hit || new Response(OFFLINE_FALLBACK_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }).catch(function () {
    return new Response(OFFLINE_FALLBACK_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
}

// ---------------------------------------------------------------- the product calculator (has its own saved copy, see above)
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
      return caches.open(CALC_CACHE).then(function (c) { return c.put(calcUrl_(), copy); }).catch(noop_).then(function () { return res; });
    }
    return res;
  });
  event.waitUntil(net.catch(noop_));   // the worker stays alive until the newest copy is saved, also when the saved one was shown first
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

// ---------------------------------------------------------------- what is "ours"
function ctOf_(res) { return String(res.headers.get('Content-Type') || '').toLowerCase(); }
function textOf_(buf, from, to) { return new TextDecoder('utf-8').decode(new Uint8Array(buf).subarray(from, to)); }
// A page is only worth saving (and only replaces a saved one) when it is complete, is html and is one of ours: a hotel / airport Wi-Fi sign-in page
// answers "200" for every address, and a stalled answer can end half way.
function isOurPage_(res, buf) {
  if (res.status !== 200 || res.type !== 'basic' || ctOf_(res).indexOf('text/html') === -1) return false;
  const n = buf.byteLength;
  return /<\/html>\s*$/i.test(textOf_(buf, Math.max(0, n - 400), n)) && /mahakal/i.test(textOf_(buf, 0, Math.min(n, 30000)));
}
// any other file (library, font, picture, manifest): a "200" that is a web page is a Wi-Fi sign-in page, not our file
function isOurFile_(res) { return res.status === 200 && res.type === 'basic' && ctOf_(res).indexOf('text/html') === -1; }
function isPagePath_(path) { return path === '' || /\.html?$/i.test(path); }
// a page or a file the browser opens as a page; a PDF / picture / download opened by its address is left alone
function isPageUrl_(url) { return !/\.[A-Za-z0-9]{1,6}$/.test(url.pathname) || /\.html?$/i.test(url.pathname); }

// the whole answer (headers AND body) must arrive within `ms`, so a connection that stalls half way can never leave a half page on the screen
function fetchWhole_(req, ms) {
  return new Promise(function (resolve, reject) {
    const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    let over = false;
    const timer = setTimeout(function () { over = true; if (ctl) { try { ctl.abort(); } catch (e) { /* already over */ } } reject(new TypeError('too slow')); }, ms);
    fetch(req, ctl ? { signal: ctl.signal } : undefined).then(function (res) {
      if (res.type === 'opaqueredirect' || res.status === 0) { clearTimeout(timer); if (!over) resolve({ res: res, passThrough: true }); return; }   // a redirect: the browser follows it
      return res.arrayBuffer().then(function (buf) { clearTimeout(timer); if (!over) resolve({ res: res, buf: buf }); });
    }).catch(function (e) { clearTimeout(timer); if (!over) reject(e); });
  });
}
// the answer again as a Response (the body is read already; the encoding / length headers are not carried over, the other headers are)
const SKIP_HEADERS = /^(?:content-encoding|content-length|transfer-encoding|connection|keep-alive)$/i;
function rebuild_(a, from) {
  const h = new Headers();
  a.res.headers.forEach(function (v, k) { if (!SKIP_HEADERS.test(k)) { try { h.append(k, v); } catch (e) { /* a header the worker may not set */ } } });
  h.set('X-MW-From', from);
  const s = a.res.status, noBody = (s === 204 || s === 205 || s === 304);
  return new Response(noBody ? null : a.buf, { status: s, statusText: a.res.statusText, headers: h });
}

// ---------------------------------------------------------------- the other pages of the app
// the saved copy of a page is kept under its address without "?..." and "#..." (order.html?x=1 and order.html are the same page)
function pageKey_(url) { const u = new URL(url); return u.origin + u.pathname; }
function savedPage_(key) {
  return caches.open(SHELL_CACHE).then(function (c) { return c.match(key, { ignoreVary: true }); }).catch(function () { return null; });
}
function pageResponse_(event) {
  const req = event.request, key = pageKey_(req.url);
  const net = fetchWhole_(req, PAGE_GIVE_UP_MS);
  event.waitUntil(net.then(function (a) {                          // the worker stays alive until the newest copy is saved, also when the saved one was shown first
    if (a.passThrough || !isOurPage_(a.res, a.buf)) return;
    return caches.open(SHELL_CACHE).then(function (c) { return c.put(key, rebuild_(a, 'cache')); });
  }).catch(noop_));
  return new Promise(function (resolve) {
    let done = false;
    function finish(r) { if (!done) { done = true; resolve(r); } }
    function savedOr_(make) { savedPage_(key).then(function (hit) { return hit || make(); }).then(finish, function () { return Promise.resolve(make()).then(finish); }); }
    net.then(function (a) {
      if (a.passThrough) { finish(a.res); return; }
      const s = a.res.status;
      if (s === 404 || (s >= 500 && s <= 599)) { savedOr_(offlineResponse_); return; }                 // the server cannot give the page: the saved one, else the "Can't connect" page
      if (ctOf_(a.res).indexOf('text/html') !== -1 && !isOurPage_(a.res, a.buf)) { savedOr_(function () { return rebuild_(a, 'network'); }); return; }   // not our page (a Wi-Fi sign-in page) or an incomplete one
      finish(rebuild_(a, 'network'));
    }, function () { savedOr_(offlineResponse_); });
    setTimeout(function () { if (!done) savedPage_(key).then(function (hit) { if (hit) finish(hit); }); }, PAGE_WAIT_MS);    // a slow connection: do not keep the phone waiting when a saved copy exists
  });
}

// ---------------------------------------------------------------- libraries, fonts, icons
function isVendor_(url) { return url.pathname.indexOf(new URL('vendor/', self.registration.scope).pathname) === 0; }
function isStatic_(url) { return /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json)$/i.test(url.pathname); }
function fetchAndSave_(req) {
  return fetch(req).then(function (res) {
    if (isOurFile_(res)) { const copy = res.clone(); caches.open(SHELL_CACHE).then(function (c) { return c.put(req, copy); }).catch(noop_); }
    return res;
  });
}
function savedFile_(req) {
  return caches.open(SHELL_CACHE).then(function (c) { return c.match(req, { ignoreVary: true }); }).catch(function () { return null; });
}
function cacheFirst_(event) {                                      // libraries and fonts never change under the same name: the saved one at once
  return savedFile_(event.request).then(function (hit) { return hit || fetchAndSave_(event.request); });
}
function staleWhileRevalidate_(event) {                           // icons, manifests: the saved one at once, renewed in the background
  return savedFile_(event.request).then(function (hit) {
    const net = fetchAndSave_(event.request);
    if (hit) { event.waitUntil(net.catch(noop_)); return hit; }
    return net;
  });
}

// ---------------------------------------------------------------- saving the app in the background
function fetchChecked_(path) {                                    // one file of the app, asked fresh from the server; null when it cannot be had now or is not ours
  return fetchWhole_(new Request(rel_(path), { cache: 'reload' }), FILE_GIVE_UP_MS).then(function (a) {
    if (a.passThrough) return null;
    return (isPagePath_(path) ? isOurPage_(a.res, a.buf) : isOurFile_(a.res)) ? a : null;
  }).catch(function () { return null; });
}
function saveOne_(cache, path, force) {
  const url = rel_(path), calc = isCalcPage_(url);
  return (calc ? savedCalc_() : cache.match(url, { ignoreVary: true })).then(function (hit) {
    if (hit && !force) return;
    return fetchChecked_(path).then(function (a) {
      if (!a) return;
      if (calc) return caches.open(CALC_CACHE).then(function (c) { return c.put(calcUrl_(), rebuild_(a, 'cache')); });
      return cache.put(url, rebuild_(a, 'cache'));
    });
  }).catch(noop_);
}
function warm_() {
  const metaKey = rel_('__mw_version');
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(metaKey).then(function (m) { return m ? m.text() : ''; }).then(function (seen) {
      const force = seen !== VERSION;                                // a new version of this worker: every file is saved again (the pages of this deployment)
      let chain = Promise.resolve();
      WARM_FILES.forEach(function (p) { chain = chain.then(function () { return saveOne_(cache, p, force); }); });
      return chain.then(function () { return force ? cache.put(metaKey, new Response(VERSION)) : null; });
    });
  }).catch(noop_);
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    Promise.all([
      caches.open(OFFLINE_CACHE)
        .then(function (cache) { return cache.add(new Request(OFFLINE_URL, { cache: 'reload' })); })
        .catch(noop_),                                               // could not keep the offline page now - the app still works, a built-in copy is used instead
      caches.open(SHELL_CACHE).then(function (cache) {
        return Promise.all(CORE_FILES.map(function (p) { return saveOne_(cache, p, true); }));   // one that cannot be saved now is saved when it is opened
      }).catch(noop_)
    ]).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return (k.indexOf('mw-offline-') === 0 && k !== OFFLINE_CACHE) || (k.indexOf('mw-calc-') === 0 && k !== CALC_CACHE) || (k.indexOf('mw-shell-') === 0 && k !== SHELL_CACHE);
        }).map(function (k) { return caches.delete(k); }));
      })
      .catch(noop_)
      .then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'mw-warm') event.waitUntil(warm_());
});
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;                                              // saving something is never touched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/.well-known/') !== -1) return;     // the database, other sites' pictures, maps: straight to the network
  if (req.mode === 'navigate') {
    if (isCalcPage_(req.url)) { event.respondWith(calcResponse_(event)); return; }       // the product calculator: also opens with no internet
    if (!isPageUrl_(url)) return;
    event.respondWith(pageResponse_(event));
    return;
  }
  if (req.headers.has('range')) return;
  if (isVendor_(url)) { event.respondWith(cacheFirst_(event)); return; }
  if (isStatic_(url)) { event.respondWith(staleWhileRevalidate_(event)); return; }
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

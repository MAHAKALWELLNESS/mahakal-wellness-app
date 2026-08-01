// Minimal service worker - required by browsers to show the "Install app"
// prompt. This app is fully live-data-driven (Supabase), so it intentionally
// does NOT cache pages or attempt offline support - it simply passes every
// request straight through to the network unchanged.
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  self.clients.claim();
});
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});

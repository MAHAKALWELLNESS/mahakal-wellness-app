// Service worker - required by browsers to show the "Install app" prompt,
// and now also handles incoming push notifications. This app is fully
// live-data-driven (Supabase), so it intentionally does NOT cache pages or
// attempt offline support - it simply passes every request straight
// through to the network unchanged.
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  self.clients.claim();
});
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', function (event) {
  let data = { title: 'Mahakal Wellness', body: 'You have a new update.' };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Mahakal Wellness', {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png'
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
      if (clients.openWindow) return clients.openWindow('order.html');
    })
  );
});

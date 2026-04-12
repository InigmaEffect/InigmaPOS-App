const CACHE_NAME = 'inigma-pos-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use individual adds to prevent failure if one asset is missing (like the icon)
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Notification', body: 'New update available' };
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || '/icons/icon.png',
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

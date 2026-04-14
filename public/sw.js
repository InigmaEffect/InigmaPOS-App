const CACHE_NAME = 'inigma-pos-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/845147__sadiquecat__airplane-ding.wav',
  '/snorcon-low-battery-421820.mp3',
  '/49053354-electronic-ping-305767.mp3',
  '/freesound_community-car-seatbelt-alarm-86950.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // For the main page, try network first, then cache
  if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For other assets, try cache first, then network
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((fetchResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (event.request.url.startsWith(self.location.origin)) {
            cache.put(event.request, fetchResponse.clone());
          }
          return fetchResponse;
        });
      });
    })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data.json();
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || '/icon.png',
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') {
    const orderId = event.notification.tag.split('_')[1];
    clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'DISMISS_ALERT', orderId }));
    });
    return;
  }

  if (event.action === 'dismiss_all') {
    clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'DISMISS_ALL' }));
    });
    return;
  }

  event.waitUntil(
    clients.openWindow('/')
  );
});

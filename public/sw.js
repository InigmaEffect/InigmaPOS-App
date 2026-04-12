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

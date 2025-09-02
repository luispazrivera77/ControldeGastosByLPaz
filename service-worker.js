// Service Worker for Reloj Minimalista
// Version 1.0.0

const CACHE_NAME = 'reloj-minimalista-v1.0.0';
const APP_PREFIX = 'reloj-';

// Files to cache for offline functionality
const CACHE_FILES = [
  './',
  './index.html',
  './manifest.json',
  // Icons
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-192x192.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png',
  // Shortcut icons
  './icons/shortcut-alarm.png',
  './icons/shortcut-fullscreen.png',
  // External alarm sound (will try to cache but won't fail if unavailable)
  'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg'
];

// Essential files that must be cached
const ESSENTIAL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

// Install Event - Cache files
self.addEventListener('install', (event) => {
  console.log('SW Reloj: Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('SW Reloj: Cacheando archivos esenciales...');
        return cache.addAll(ESSENTIAL_FILES);
      })
      .then(() => {
        console.log('SW Reloj: Archivos esenciales cacheados');
        return caches.open(CACHE_NAME);
      })
      .then((cache) => {
        // Cache additional files (non-blocking)
        const cachePromises = CACHE_FILES.map(url => {
          return cache.add(url).catch(err => {
            console.warn(`SW Reloj: No se pudo cachear ${url}:`, err.message);
            return Promise.resolve();
          });
        });
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log('SW Reloj: Instalación completada');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('SW Reloj: Error durante instalación:', error);
      })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('SW Reloj: Activando...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        const deletePromises = cacheNames.map((cacheName) => {
          if (cacheName.startsWith(APP_PREFIX) && cacheName !== CACHE_NAME) {
            console.log('SW Reloj: Eliminando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        });
        return Promise.all(deletePromises);
      })
      .then(() => {
        console.log('SW Reloj: Activado correctamente');
        return self.clients.claim();
      })
  );
});

// Fetch Event - Serve cached content
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  const url = new URL(event.request.url);
  
  // Handle different types of requests
  if (url.origin === self.location.origin) {
    // Same origin requests - use cache-first strategy
    event.respondWith(handleSameOriginRequest(event.request));
  } else if (url.href.includes('alarm_clock.ogg')) {
    // Handle alarm sound - network first, then cache
    event.respondWith(handleAlarmSound(event.request));
  } else {
    // Other external requests - let them pass through
    return;
  }
});

// Handle same-origin requests (cache-first strategy)
function handleSameOriginRequest(request) {
  return caches.match(request)
    .then((cachedResponse) => {
      if (cachedResponse) {
        console.log('SW Reloj: Sirviendo desde caché:', request.url);
        return cachedResponse;
      }
      
      // Not in cache, fetch from network
      return fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          
          // Clone and cache the response
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              console.log('SW Reloj: Cacheando nueva respuesta:', request.url);
              cache.put(request, responseToCache);
            });
          
          return networkResponse;
        })
        .catch((error) => {
          console.log('SW Reloj: Error de red, sirviendo offline:', request.url);
          
          // If it's a navigation request, return the main page
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          
          throw error;
        });
    });
}

// Handle alarm sound (network-first strategy)
function handleAlarmSound(request) {
  return fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        // Cache the sound for offline use
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            console.log('SW Reloj: Cacheando sonido de alarma');
            cache.put(request, responseToCache);
          });
      }
      return networkResponse;
    })
    .catch(() => {
      // If network fails, try to get from cache
      console.log('SW Reloj: Red falló, buscando sonido en caché');
      return caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return a simple error response if no cached version
          return new Response('', { status: 404 });
        });
    });
}

// Background Sync - for alarm persistence
self.addEventListener('sync', (event) => {
  if (event.tag === 'clock-sync') {
    console.log('SW Reloj: Sincronización en segundo plano');
    event.waitUntil(
      // Here we could sync clock preferences or alarm data
      syncClockData()
    );
  }
});

function syncClockData() {
  return new Promise((resolve) => {
    // Simulate syncing clock preferences
    console.log('SW Reloj: Datos sincronizados');
    resolve();
  });
}

// Push notifications for alarms (future feature)
self.addEventListener('push', (event) => {
  console.log('SW Reloj: Push notification recibida');
  
  const options = {
    body: '⏰ ¡Es hora! Tu alarma está sonando.',
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-72x72.png',
    tag: 'clock-alarm',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      {
        action: 'dismiss',
        title: '❌ Descartar',
        icon: './icons/shortcut-alarm.png'
      },
      {
        action: 'snooze',
        title: '😴 Posponer',
        icon: './icons/shortcut-fullscreen.png'
      }
    ],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };
  
  event.waitUntil(
    self.registration.showNotification('Reloj Minimalista - Alarma', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('SW Reloj: Notificación clickeada:', event.action);
  
  event.notification.close();
  
  if (event.action === 'dismiss') {
    // Just close the notification
    return;
  }
  
  if (event.action === 'snooze') {
    // Could implement snooze functionality here
    console.log('SW Reloj: Función de posponer');
    return;
  }
  
  // Default action - open the app
  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then((clientList) => {
        // If app is already open, focus it
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes('/') && 'focus' in client) {
            return client.focus();
          }
        }
        // If app is not open, open it
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log('SW Reloj: Mensaje recibido:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({
      version: CACHE_NAME,
      cached_files: CACHE_FILES.length
    });
  }
  
  if (event.data && event.data.type === 'SCHEDULE_ALARM') {
    // Handle alarm scheduling from main app
    console.log('SW Reloj: Programando alarma para:', event.data.time);
    scheduleAlarmNotification(event.data.time);
  }
});

// Schedule alarm notification (helper function)
function scheduleAlarmNotification(alarmTime) {
  // This would typically use the Background Sync API or 
  // coordinate with the main app for alarm timing
  console.log('SW Reloj: Alarma programada para:', alarmTime);
}

// Handle app installation
self.addEventListener('appinstalled', (event) => {
  console.log('SW Reloj: App instalada correctamente');
});

// Handle app update available
self.addEventListener('controllerchange', (event) => {
  console.log('SW Reloj: Nueva versión disponible');
  
  // Notify the main app about the update
  self.clients.matchAll()
    .then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_UPDATED',
          message: 'Nueva versión del reloj disponible'
        });
      });
    });
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'clock-update') {
    console.log('SW Reloj: Sincronización periódica');
    event.waitUntil(
      // Could check for app updates or sync time
      Promise.resolve()
    );
  }
});

// Error handling
self.addEventListener('error', (event) => {
  console.error('SW Reloj: Error global:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('SW Reloj: Promise rechazada:', event.reason);
  event.preventDefault();
});

console.log('SW Reloj: Service Worker cargado correctamente');
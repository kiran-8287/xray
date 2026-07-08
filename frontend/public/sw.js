// Service Worker for X-Ray Collage Generator
// Caches images and static assets for offline use and faster loading

const CACHE_NAME = 'xray-collage-v1';
const STATIC_CACHE_NAME = 'xray-static-v1';
const IMAGE_CACHE_NAME = 'xray-images-v1';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Installation complete');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Installation failed:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return name !== STATIC_CACHE_NAME && name !== IMAGE_CACHE_NAME;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activation complete');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle image requests
  if (request.destination === 'image') {
    event.respondWith(handleImageRequest(request));
    return;
  }

  // Handle API requests - network only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Handle static assets - cache first
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200) {
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            // Cache the static asset
            caches.open(STATIC_CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/');
            }
          });
      })
  );
});

// Handle image requests with cache-first strategy
async function handleImageRequest(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    
    if (response && response.status === 200) {
      const responseToCache = response.clone();
      
      // Cache the image
      const cache = await caches.open(IMAGE_CACHE_NAME);
      cache.put(request, responseToCache);
    }
    
    return response;
  } catch (error) {
    console.error('[SW] Failed to fetch image:', error);
    // Return a placeholder or throw
    throw error;
  }
}

// Listen for messages from the client
self.addEventListener('message', (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'CACHE_IMAGES':
      // Pre-cache images
      cacheImages(payload.urls);
      break;
    
    case 'CLEAR_CACHE':
      // Clear all caches
      caches.keys()
        .then((names) => {
          return Promise.all(names.map((name) => caches.delete(name)));
        })
        .then(() => {
          event.ports[0].postMessage({ success: true });
        });
      break;
    
    default:
      break;
  }
});

// Cache multiple images
async function cacheImages(urls) {
  const cache = await caches.open(IMAGE_CACHE_NAME);
  
  await Promise.all(
    urls.map((url) => {
      return cache.add(url).catch((err) => {
        console.error('[SW] Failed to cache image:', url, err);
      });
    })
  );
  
  console.log(`[SW] Cached ${urls.length} images`);
}

export {};
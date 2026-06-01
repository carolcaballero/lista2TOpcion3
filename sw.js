const CACHE_NAME = 'ce-v12-cache-v7'; // ← Incrementar versión
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './data/padron_san_estanislao_2026_completo.csv', // ← Agregar CSV
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js'
];

// URLs de Google Fonts para cachear (incluyendo display=swap)
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
  'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2',
  'https://fonts.gstatic.com/s/materialsymbolsoutlined/v192/kJEhBvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzByHX9rA6RzaxHMPdY43zj-jCxv3fzvRNU22ZXGJpEpjC_1v-p_4MrImHCIJIZrDCvHOejbd5zrDAt.woff2'
];

const ALL_CACHE_URLS = [...STATIC_ASSETS, ...FONT_URLS];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cachear recursos uno por uno para que un fallo no rompa todo
      const results = await Promise.allSettled(
        ALL_CACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn(`[SW] Falló cache de ${url}:`, err.message);
          return null;
        }))
      );
      const exitosos = results.filter(r => r.status === 'fulfilled').length;
      console.log(`[SW] Cacheados ${exitosos}/${ALL_CACHE_URLS.length} recursos`);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log(`[SW] Eliminando cache viejo: ${key}`);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Firebase/Firestore: network first, sin cachear respuestas
  if (url.hostname.includes('firestore') || 
      url.hostname.includes('googleapis') ||
      url.hostname.includes('firebase')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // 2) Google Fonts CSS: stale-while-revalidate (cache primero, actualiza en background)
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3) Google Fonts archivos WOFF2: cache first (raramente cambian)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4) Recursos locales y CDNs: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Estrategia: Cache First (para fuentes que raramente cambian)
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    // Refrescar en background silenciosamente
    fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
    }).catch(() => {});
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}

// Estrategia: Stale While Revalidate (para CSS y JS)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(err => {
    console.warn(`[SW] Fetch falló para ${request.url}`);
    return null;
  });
  
  // Si tenemos cache, devolverlo inmediatamente mientras refrescamos
  if (cached) {
    networkPromise; // Trigger background update
    return cached;
  }
  
  // Si no hay cache, esperar la red
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  
  // Fallback final para navegación
  if (request.mode === 'navigate') {
    return caches.match('./index.html');
  }
  
  return new Response('Recurso no disponible offline', { status: 503 });
}

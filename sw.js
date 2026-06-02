// ═══════════════════════════════════════════════════════════════
//  SERVICE WORKER — Control Electoral v13
//  Actualizado: ambas variantes Material Symbols (Outlined + Rounded)
//               favicon inline (sin favicon.ico externo)
//               Firebase en gstatic → excluido del cache de fuentes
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'ce-v13-cache-v2'; // ← incrementar cuando cambies assets

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './data/padron_san_estanislao_2026_completo.csv',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js'
];

// Google Fonts CSS — ambas variantes en una sola request (como en index.html actualizado)
const FONT_CSS_URLS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
  // Outlined + Rounded en una sola URL combinada (igual que index.html)
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap'
];

// Archivos WOFF2 precargados para offline
// Nota: las URLs exactas de woff2 pueden rotar en Google Fonts — se cachean
// dinámicamente en el fetch handler. Estas son las más estables conocidas:
const FONT_WOFF2_URLS = [
  // Inter variable
  'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2',
  // Material Symbols Outlined (variable, todos los pesos)
  'https://fonts.gstatic.com/s/materialsymbolsoutlined/v192/kJEhBvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzByHX9rA6RzaxHMPdY43zj-jCxv3fzvRNU22ZXGJpEpjC_1v-p_4MrImHCIJIZrDCvHOejbd5zrDAt.woff2',
  // Material Symbols Rounded (variable, todos los pesos)
  'https://fonts.gstatic.com/s/materialsymbolsrounded/v192/sIHP_-Tp9oCLkHcFRJaIBolkHFqe5cFyMvpL7z6bTxpD58g_XT3_vHzQgAUoMf64LXuwB8OY.woff2'
];

const ALL_PRECACHE = [...STATIC_ASSETS, ...FONT_CSS_URLS, ...FONT_WOFF2_URLS];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      let ok = 0, fail = 0;
      await Promise.allSettled(
        ALL_PRECACHE.map(url =>
          cache.add(url).then(() => { ok++; }).catch(err => {
            fail++;
            console.warn(`[SW] No se pudo cachear: ${url} →`, err.message);
          })
        )
      );
      console.log(`[SW] Install completo: ${ok} OK, ${fail} fallos de ${ALL_PRECACHE.length}`);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────────
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
    ).then(() => {
      console.log(`[SW] Activado con cache: ${CACHE_NAME}`);
    })
  );
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Firebase Firestore / Auth / RTDB → network only, nunca cachear respuestas
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    // Firebase SDK vive en gstatic pero NO son fuentes — hay que diferenciarlo
    (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebasejs'))
  ) {
    event.respondWith(
      fetch(request).catch(() => {
        // Offline con Firebase → respuesta vacía para no bloquear la app
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2) Google Fonts CSS → stale-while-revalidate (cambia poco, necesita red para updates)
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3) Google Fonts WOFF2 (fonts.gstatic.com, NO firebasejs) → cache-first
  //    Las fuentes no cambian — si están en cache, sirven para siempre
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4) CDNs de terceros (chart.js, xlsx, etc.) → cache-first con fallback
  if (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname.includes('cdn.sheetjs.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 5) Recursos locales (HTML, CSS, JS, CSV, imágenes) → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── ESTRATEGIAS DE CACHE ──────────────────────────────────────────

/**
 * Cache First: devuelve del cache si existe, actualiza en background.
 * Ideal para fuentes y CDNs que raramente cambian.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    // Refresh silencioso en background para tener versión fresca la próxima vez
    fetch(request)
      .then(res => { if (res.ok) cache.put(request, res.clone()); })
      .catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Recurso no disponible offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Stale While Revalidate: sirve del cache de inmediato (si existe)
 * y actualiza en background. Si no hay cache, espera la red.
 * Ideal para HTML/CSS/JS locales y Google Fonts CSS.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Lanzar fetch en background siempre
  const networkPromise = fetch(request)
    .then(res => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    // Tenemos algo en cache: lo devolvemos ahora, red actualiza en background
    return cached;
  }

  // Sin cache: esperar la red
  const networkRes = await networkPromise;
  if (networkRes) return networkRes;

  // Fallback de navegación: servir index.html para rutas SPA
  if (request.mode === 'navigate') {
    const indexFallback = await cache.match('./index.html');
    if (indexFallback) return indexFallback;
  }

  return new Response('Recurso no disponible offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

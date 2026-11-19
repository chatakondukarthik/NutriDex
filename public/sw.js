/*
 * NutriPlan — tiny production service worker.
 *
 * Goals: installability + graceful offline. Not a stale-cache trap.
 *   - navigations: network-first, falling back to the cached page, then /offline.html
 *   - static build assets (/_next/static), icons, manifest: cache-first (they are hashed)
 * Registration happens from the client shell (see ServiceWorkerRegistrar).
 */
const VERSION = "nutriplan-v1";
const SHELL = ["/offline.html", "/icon.svg", "/favicon-32x32.png", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clientsClaim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/offline.html")),
        ),
    );
    return;
  }

  if (/^\/(_next\/static|icon|favicon|pwa-|apple-touch-icon|manifest\.json|offline\.html)/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          }),
      ),
    );
  }
});

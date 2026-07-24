const CACHE_VERSION = "push-lab-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const STATIC_ASSETS = ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function shouldBypassCache(request) {
  const url = new URL(request.url);
  return url.pathname.includes("/functions/v1/") || request.method !== "GET";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (shouldBypassCache(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match("/offline.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const url = new URL(request.url);
        if (url.origin === self.location.origin && response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

function safeString(value, fallback, limit) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, limit);
}

function safeUrl(value, fallback = "/") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const url = new URL(value, self.location.origin);
    if (url.protocol !== "https:" && url.origin !== self.location.origin) return fallback;
    if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "file:") return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = {};
      }

      const title = safeString(data.title, "Push Lab Pessoal", 120);
      const options = {
        body: safeString(data.body, "Voce recebeu uma notificacao.", 600),
        icon: safeUrl(data.icon_url, "/icons/icon-192.png"),
        badge: safeUrl(data.badge_url, "/icons/icon-192.png"),
        image: data.image_url ? safeUrl(data.image_url, undefined) : undefined,
        tag: safeString(data.tag, undefined, 80),
        data: {
          target_url: safeUrl(data.target_url, "/"),
          notification_id: safeString(data.notification_id, "", 80),
          created_at: new Date().toISOString()
        },
        timestamp: Date.now(),
        renotify: Boolean(data.tag)
      };

      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeUrl(event.notification.data?.target_url, "/");

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        const wantedUrl = new URL(targetUrl);
        if (clientUrl.origin === wantedUrl.origin && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return undefined;
    })
  );
});


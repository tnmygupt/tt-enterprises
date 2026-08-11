/* TT Enterprises PWA SW v4 — recovery + push; never intercepts navigations */
const SW_VERSION = "tt-sw-v4";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        /* ignore */
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((key) => {
            if (key !== SW_VERSION) return caches.delete(key);
            return undefined;
          })
        );
      } catch {
        /* ignore */
      }
      // Do NOT clients.claim() — claiming without a fetch handler has broken
      // some iOS/Android home-screen launches. Push still works after next load.
    })()
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "TT Enterprises",
    body: "You have an update",
    url: "/en?v=4&source=pwa",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: parsed.title || data.title,
        body: parsed.body || data.body,
        url: parsed.url || data.url,
      };
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/brand/icon-192.png",
      badge: "/brand/icon-192.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) ||
    "/en?v=4&source=pwa";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clientList) => {
        for (const client of clientList) {
          if ("focus" in client && client.url.includes(self.location.origin)) {
            if ("navigate" in client) {
              try {
                client.navigate(url);
              } catch {
                /* ignore */
              }
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      }
    )
  );
});

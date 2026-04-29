// Service worker for web push notifications. Kept intentionally tiny:
// the app does not use this worker for offline caching, just for push.
// If you later want PWA caching strategies (Workbox, etc.) layer them
// on top of this file rather than replacing it, so the push handlers
// stay live during installation.
//
// Three handlers:
//   * install   — skipWaiting() so the worker activates on first load
//                 instead of waiting for all old tabs to close.
//   * activate  — clients.claim() so the worker controls the page that
//                 just registered it without a reload.
//   * push      — parse the JSON payload from the edge function and
//                 surface a notification with title/body/icon/data.
//   * notificationclick — focus an existing tab if there is one,
//                 otherwise open a new one at the URL the payload
//                 carries (or `/` as a fallback).

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Snout", body: "You have a new update.", url: "/" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/favicon.ico",
      badge: payload.badge || "/favicon.ico",
      tag: payload.tag || undefined,
      data: { url: payload.url || "/" },
      // Lets the user dismiss the notification rather than auto-closing.
      requireInteraction: payload.requireInteraction === true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // If a tab is already open at the same origin, focus it and
      // navigate. Cheaper than opening a new tab and avoids piling up
      // duplicate Snout windows.
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url);
          const targetParsed = new URL(targetUrl, self.location.origin);
          if (clientUrl.origin === targetParsed.origin) {
            await client.focus();
            if (clientUrl.pathname + clientUrl.search !== targetParsed.pathname + targetParsed.search) {
              await client.navigate(targetParsed.toString()).catch(() => {});
            }
            return;
          }
        } catch {
          /* ignore parse errors */
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

/*
 * ROLLBACK ONLY — not served under this name.
 *
 * A service worker is sticky: once installed it outlives the deploy that
 * introduced it, and a faulty one can keep serving broken content to a device
 * long after the mistake is fixed on the server. This file is the way out.
 *
 * To use it: copy over public/sw.js, deploy, and every device that checks for
 * an update will drop its caches and unregister. Restore the real sw.js after.
 * Note that unregistering also ends push subscriptions on that device, so the
 * children have to tap the bell again — which is the correct trade when the
 * alternative is an app that will not load.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});

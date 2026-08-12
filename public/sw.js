/* Family Calendar service worker: notifications, plus read-only offline. */

/*
 * Bump this to invalidate everything cached by an older worker. Old caches are
 * deleted on activate, so a version that ships a mistake is corrected by the
 * next deploy rather than lingering on the device.
 */
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;

/*
 * Bumping VERSION also means updating the copy in KidDay.tsx and in the tests.
 * A service worker in public/ cannot import from the app, so the name is
 * duplicated rather than shared.
 */

/** Enough to render offline immediately after installing, before any second visit. */
const PRECACHE = ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/badge.png", "/notification-icon.png"];

/**
 * A slow network is commoner than no network. Without a ceiling, a child on a
 * weak signal waits for the request to fail — which can be half a minute —
 * instead of seeing yesterday's copy at once.
 */
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {}) // a missing icon must not block the worker
      .then(() => self.skipWaiting()),
  ),
);

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL && key !== PAGES) await caches.delete(key);
      }
      // Without claiming, a faulty worker survives until every tab is closed,
      // which on iOS can be days.
      await self.clients.claim();
    })(),
  ),
);

/**
 * Offline for the child's calendar, and nothing else.
 *
 * Every branch either handles a request or returns without calling
 * respondWith, which leaves the browser to do exactly what it does today. That
 * is the safety property: there is no path by which this changes behaviour for
 * an online user, because documents are fetched from the network first and the
 * cache is consulted only after the network has already failed.
 *
 * A child's page carries a month of events in the document itself, so one
 * cached response covers everything they can scroll to. No data layer needed.
 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never writes: actions, subscribe, done

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never the API
  if (url.searchParams.has("_rsc")) return; // never a React payload — router.refresh stays live

  // Content-hashed, so a hit is always the right bytes. Caching these also means
  // a device keeps the chunks its cached page refers to, which removes the
  // stale-HTML-meets-purged-asset failure that exists today without any worker.
  const immutable =
    url.pathname.startsWith("/_next/static/") ||
    /^\/(icon-|badge|apple-touch-icon|notification-icon|favicon)/.test(url.pathname);

  if (immutable) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Only the child's own screens. The parent app needs the network anyway, and
  // leaving it alone keeps the blast radius of this change to one route.
  if (req.mode === "navigate" && url.pathname.startsWith("/k/")) {
    /*
     * Stored under the path alone, with the query dropped. Every reminder links
     * to the day it is about — /k/<token>?d=2026-08-09 — so keying on the full
     * URL meant the commonest way a child opens this app offline, tapping a
     * notification, was always a miss. It also bounds the cache to one entry
     * per child rather than one per day ever viewed.
     */
    const key = url.origin + url.pathname;

    event.respondWith(
      (async () => {
        const network = fetch(req).then((res) => {
          if (!res.ok) {
            // The token is gone — replaced, or the child removed. Drop the copy,
            // or a revoked link keeps rendering from cache the moment the
            // network is slow or absent, and rotation stops meaning anything.
            event.waitUntil(caches.open(PAGES).then((cache) => cache.delete(key)));
          }
          if (res.ok) {
            // Clone the moment it arrives, and keep the worker alive until the
            // copy is stored. Awaiting the write before returning would
            // deadlock instead: the clone cannot drain until the browser starts
            // reading the original, and the browser has not been given it yet.
            const copy = res.clone();
            event.waitUntil(caches.open(PAGES).then((cache) => cache.put(key, copy)));
          }
          return res;
        });

        const cached = await caches.match(key, { cacheName: PAGES });
        // Nothing to fall back to, so there is nothing to gain by giving up early.
        if (!cached) return network;

        return Promise.race([
          network,
          new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS)),
        ]).catch(() => cached);
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = null;

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      const text = event.data.text();
      data = text ? { title: "Family Calendar", body: text } : null;
    }
  }

  // No readable payload means the browser could not decrypt what the server sent —
  // a broken signing or encryption path, which the server sees as success. Say so
  // out loud: a blank notification trains the child to ignore the useful ones.
  const unreadable = !data || !data.title;

  const options = {
    body: unreadable ? "Open your calendar to see what's next." : data.body || "",
    // `icon` is the picture inside the notification; Android crops it to a
    // circle, so it is drawn round with padding. `badge` is the status-bar
    // glyph and Android uses its ALPHA ONLY, tinted — a colour image renders
    // there as a grey blob, which is what the app icon was doing.
    icon: "/notification-icon.png",
    badge: "/badge.png",
    tag: unreadable ? "unreadable" : data.tag || "family-calendar",
    renotify: true,
    data: { url: (data && data.url) || "/" },
    vibrate: [40, 60, 40],
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(unreadable ? "Reminder couldn't be read" : data.title, options),
      // Chrome forbids a truly silent push — userVisibleOnly is mandatory — but
      // any open page can still be told to refetch at the same moment.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((cs) => cs.forEach((c) => c.postMessage({ type: "refresh" }))),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  // Match on the path so an already-open window is reused, then steer it to the
  // day the notification is about rather than leaving it on today.
  const path = target.split("?")[0];

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(path)) {
          if ("navigate" in client) return client.navigate(target).then((c) => (c || client).focus());
          if ("focus" in client) return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

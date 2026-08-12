/**
 * One service worker per child, scoped to that child's own path.
 *
 * It used to register at the origin root. That meant a single worker and a
 * single push subscription for the whole site, with two consequences: a phone
 * could only ever remind one child, whoever tapped the bell last; and Android
 * would not credit a reminder to the installed app, because the worker sending
 * it was not inside that app's scope — so notifications arrived branded as
 * Chrome, complete with an Unsubscribe button one tap from a child.
 *
 * Migrating means retiring the old root registration, and unsubscribing it
 * first. Without that its endpoint stays alive and every reminder arrives
 * twice until the server prunes it on a failed send — the same duplicate that
 * two origins produced once before.
 */
export async function ensureWorker(token: string): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    for (const old of await navigator.serviceWorker.getRegistrations()) {
      if (new URL(old.scope).pathname !== "/") continue;
      const sub = await old.pushManager.getSubscription().catch(() => null);
      if (sub) await sub.unsubscribe().catch(() => {});
      await old.unregister().catch(() => {});
    }

    // Narrowing a scope needs no Service-Worker-Allowed header; only widening
    // beyond the script's own directory does.
    return await navigator.serviceWorker.register("/sw.js", { scope: `/k/${token}` });
  } catch {
    // A child's calendar must render whether or not any of this works.
    return null;
  }
}

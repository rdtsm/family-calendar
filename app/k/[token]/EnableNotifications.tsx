"use client";

import { useEffect, useState } from "react";
import { ensureWorker } from "./registerWorker";

type State = "unsupported" | "off" | "on" | "working" | "confirmed" | "blocked";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function EnableNotifications({ token, accent }: { token: string; accent: string }) {
  const [state, setState] = useState<State>("off");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("blocked");
    ensureWorker(token)
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, [token]);

  /**
   * Also runs when reminders are already on. Subscriptions are tied to an
   * origin and can be dropped by the browser, so re-tapping re-registers the
   * device rather than being a dead button — which is what you need after the
   * app moves to a new address, or if reminders ever stop arriving.
   */
  async function enable() {
    const wasOn = state === "on";
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");

      const reg = await ensureWorker(token);
      if (!reg) throw new Error("no service worker");
      await navigator.serviceWorker.ready;

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("missing VAPID public key");

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("subscribe failed");

      // A visible acknowledgement, so re-tapping tells you something happened.
      // It returns to "on", which is now a state you can actually see: a tick
      // badge that stays. Previously the only difference between on and off was
      // a faint background tint, so the tick looked like the whole feedback and
      // its disappearance read as "it did not work".
      setState("confirmed");
      setTimeout(() => setState("on"), wasOn ? 1800 : 1200);
    } catch {
      setState("off");
    }
  }

  if (state === "unsupported") return null;

  const label =
    state === "on" || state === "confirmed"
      ? "Reminders are on — tap to check again"
      : state === "blocked"
        ? "Reminders are blocked in your browser settings"
        : "Turn on reminders";

  const isOn = state === "on" || state === "confirmed";

  return (
    <button
      onClick={state === "working" || state === "blocked" ? undefined : enable}
      disabled={state === "working" || state === "blocked"}
      aria-label={label}
      title={label}
      className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-lg transition active:scale-95 disabled:active:scale-100"
      style={isOn ? { background: `color-mix(in oklch, ${accent} 22%, transparent)` } : undefined}
    >
      <span aria-hidden>
        {state === "working" ? "…" : state === "confirmed" ? "✓" : state === "blocked" ? "🔕" : "🔔"}
      </span>

      {/* Off attracts a tap; on has to stay visibly on. A tick that appears and
          fades is indistinguishable from nothing having happened. */}
      {state === "off" && (
        <span
          className="absolute right-1.5 top-1.5 size-2 rounded-full"
          style={{ background: accent }}
          aria-hidden
        />
      )}
      {isOn && (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full text-[9px] font-bold text-surface"
          style={{ background: "var(--color-kid-mint-ink)" }}
          aria-hidden
        >
          ✓
        </span>
      )}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Hands the planning app to the other parent.
 *
 * It exists because the bare domain does not lead here — `ROOT_REDIRECT_URL`
 * sends it elsewhere — so `/parent` is a path that has to be communicated
 * rather than guessed, and a domain passed on by word of mouth lands the other
 * parent somewhere that looks like the app does not exist.
 *
 * Unlike everything else on this screen, this link is not a credential. The PIN
 * is. So there is nothing here to rotate, nothing to warn about, and no device
 * to watch — and the share text says the PIN travels separately rather than
 * carrying it.
 */
export default function ShareManager() {
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  const [origin, setOrigin] = useState("");

  // Only the browser knows the host, and the link has to be absolute to travel.
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}/parent` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setShared("copied");
      setTimeout(() => setShared("idle"), 1800);
    } catch {
      /* clipboard blocked — the link is printed below either way */
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Family Calendar",
          text: "Family Calendar — the app we plan the week in. Open it, then add it to your home screen. You'll need the family PIN, which I'll send separately.",
          url,
        });
      } catch {
        /* cancelled — not an error worth reporting */
      }
      return;
    }
    await copy();
  }

  return (
    <section aria-label="Share this app" className="mt-6 rounded-3xl bg-card p-4">
      <p className="text-[17px] font-semibold">Share this app</p>
      <p className="mt-0.5 text-[15px] text-fg-3">
        For another parent, or your own second phone. Safe to send — the PIN is what protects it, and
        it is not in the message.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={share}
          className="flex-1 rounded-2xl bg-fg py-3 text-[17px] font-bold text-surface transition active:scale-[0.98]"
        >
          Share link
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded-2xl bg-raised px-4 py-3 text-[17px] font-semibold text-fg transition active:scale-[0.98]"
        >
          {shared === "copied" ? "Copied ✓" : "Copy link"}
        </button>
      </div>

      {/* Printed as well as copied, so a blocked clipboard is never a dead end. */}
      <p className="mt-3 break-all text-[13px] text-fg-3">{url}</p>
    </section>
  );
}

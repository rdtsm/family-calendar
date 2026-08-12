"use client";

import { useInstall } from "@/lib/useInstall";

/**
 * Nudges a child to put the calendar on their home screen.
 *
 * This is not decoration. On iPhone, web push does not exist in a Safari tab at
 * all — `PushManager` is absent until the app is installed — so a child reading
 * their calendar in a browser can never receive a reminder, and the bell that
 * would fix it is hidden precisely because it cannot work. The result was a
 * blank corner and a child who thought reminders were simply broken.
 *
 * So the hint says what is wrong and what to do, and disappears by itself the
 * moment the app is installed. No dismiss button: dismissing it would hide the
 * only route to the feature the app exists for.
 */
export default function InstallHint({ accent }: { accent: string }) {
  const { installed, prompt, setPrompt, ios } = useInstall();

  if (installed) return null;

  return (
    <section
      aria-label="Add to home screen"
      className="mx-4 mb-3 rounded-3xl bg-card p-4"
      style={{ boxShadow: `inset 4px 0 0 0 ${accent}` }}
    >
      <p className="text-[17px] font-bold">Put me on your home screen</p>

      {ios ? (
        /*
         * No positions and no glyphs we cannot verify. The share button moves —
         * bottom on a default iPhone, top on an iPad or with the address bar at
         * the top — so it is named by its icon instead. Step one exists because
         * a link arriving in a chat opens in that app's own browser, which has
         * no Add to Home Screen at all; anyone already in Safari reads past it.
         */
        <>
          <p className="mt-1 text-[15px] text-fg-2">Reminders only work once I am there.</p>
          <ol className="mt-2 space-y-1.5 text-[15px] text-fg-2">
            <li className="flex gap-2">
              <span className="shrink-0 tabular-nums text-fg-3">1.</span>
              <span>
                If you opened this from a chat, choose <strong>Open in Safari</strong> from the menu
                first
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 tabular-nums text-fg-3">2.</span>
              <span>
                Tap the <strong>Share</strong> button — the square with an arrow pointing up
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 tabular-nums text-fg-3">3.</span>
              <span>
                Scroll down and tap <strong>Add to Home Screen</strong>
              </span>
            </li>
          </ol>
        </>
      ) : (
        /* Reminders work in the browser on Android, so promising them here would
           be untrue. What installing actually buys is what it says. */
        <p className="mt-1 text-[15px] text-fg-2">
          It gets its own icon, opens without the browser around it, and still works when you have no
          signal.
        </p>
      )}
      {prompt && (
        <button
          onClick={() => {
            prompt.prompt();
            setPrompt(null);
          }}
          className="mt-3 w-full rounded-2xl py-3 text-[17px] font-bold transition active:scale-[0.99]"
          style={{ background: accent, color: "oklch(0.20 0.012 280)" }}
        >
          Add to home screen
        </button>
      )}
      {!prompt && !ios && (
        <p className="mt-2 text-[15px] text-fg-3">
          Tap <strong>⋮</strong> in your browser, then <strong>Install app</strong> — or{" "}
          <strong>Add to Home screen</strong>, depending on the version.
        </p>
      )}
    </section>
  );
}

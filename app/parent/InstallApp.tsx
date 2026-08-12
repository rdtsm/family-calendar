"use client";

import { useInstall } from "@/lib/useInstall";

/**
 * The same nudge the children get, for the adult who plans the week.
 *
 * Without it a parent handed the link stays on a browser tab forever, which is
 * the state the whole thing is least usable in: no icon, a URL to find again,
 * and the PIN re-entered every time the tab is lost.
 *
 * Deliberately quieter than the children's version, because it sells less. It
 * cannot promise reminders — subscriptions are keyed to a child and a parent
 * gets none — and it cannot promise offline: no service worker controls
 * `/parent`, by choice, since caching PIN-guarded pages is a leak for a
 * cosmetic gain. What is left is true and still worth having.
 */
export default function InstallApp() {
  const { installed, prompt, setPrompt, ios } = useInstall();

  if (installed) return null;

  return (
    <section aria-label="Add to home screen" className="mb-5 rounded-3xl bg-card p-4">
      <p className="text-[17px] font-bold">Put this on your home screen</p>

      {ios ? (
        /* Same three steps as the children's app, and for the same reasons: a
           link opened from a chat has no Add to Home Screen at all, and the
           share button moves about, so it is named by its icon. */
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
      ) : (
        <p className="mt-1 text-[15px] text-fg-2">
          It gets its own icon and opens without the browser around it, so planning the week is one
          tap rather than a tab you have to find again.
        </p>
      )}

      {prompt && (
        <button
          onClick={() => {
            prompt.prompt();
            setPrompt(null);
          }}
          className="mt-3 w-full rounded-2xl bg-fg py-3 text-[17px] font-bold text-surface transition active:scale-[0.99]"
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

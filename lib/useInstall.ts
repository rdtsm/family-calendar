"use client";

import { useEffect, useState } from "react";

export type Prompt = Event & { prompt: () => Promise<void> };

/**
 * Everything the two install hints need to know about the browser they are in.
 *
 * Shared because this is the part that took work to get right and would have to
 * be corrected twice if it lived in two places. The copy is not shared: the
 * children's app is offline-capable and sells reminders, the parent app is
 * neither, so the same words would be false in one of them.
 */
export function useInstall() {
  // Assume installed until proven otherwise, so the banner never flashes on a
  // correctly installed app during hydration.
  const [installed, setInstalled] = useState(true);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    /*
     * iPadOS Safari calls itself Macintosh by default, so the obvious check
     * misses every iPad and hands it the Android instructions. Touch points
     * separate a real Mac from an iPad claiming to be one.
     */
    const ua = navigator.userAgent;
    setIos(/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));

    // Chrome hands over a real install prompt; Safari has no equivalent, which
    // is why iOS gets words instead of a button.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Prompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return { installed, prompt, setPrompt, ios };
}

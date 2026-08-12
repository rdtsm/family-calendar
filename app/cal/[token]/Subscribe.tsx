"use client";

import { useState } from "react";
import type { Kind } from "@/lib/db";

/**
 * Subscribing by hand means finding a settings screen most people have never
 * opened — Google buries it under Other calendars → From URL, and Outlook for
 * Mac cannot do it at all.
 *
 * So the page is four equal cards, one per app, each holding its own action.
 * An earlier version gave Apple a full-width primary button and left the other
 * clients as grey text below a floating "Copy the address", which read as
 * "Apple is the way" and left nothing connecting the copy button to the steps
 * that needed it.
 *
 * There is no Google button. Its `r?cid=` deep link opens Google Calendar and
 * then fails with "Unable to add calendar, check the URL" — the same address
 * pasted into Add calendar → From URL works. A button that reliably fails is
 * worse than no button, because it moves the blame onto the address.
 */
export default function Subscribe({ name, feedUrl, kind }: { name: string; feedUrl: string; kind: Kind }) {
  // Each card copies independently, so the confirmation appears on the button
  // that was actually pressed.
  const [copied, setCopied] = useState<string | null>(null);
  const webcal = feedUrl.replace(/^https?:/, "webcal:");

  async function copy(which: string) {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800);
    } catch {
      /* clipboard blocked — the address is printed below either way */
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16">
      <header className="safe-top pb-6 pt-8">
        <h1 className="text-[28px] font-bold leading-tight">{name}’s family calendar</h1>
        <p className="mt-2 text-[17px] text-fg-2">
          {kind === "observer"
            ? "Everything the family has on, in your own calendar app."
            : "The activities you’re on, in your own calendar app."}{" "}
          It stays up to date on its own.
        </p>
      </header>

      <h2 className="mb-3 text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">
        Choose your calendar app
      </h2>

      <div className="space-y-3">
        <Card title="Apple Calendar" sub="iPhone, iPad or Mac">
          <a
            href={webcal}
            className="block w-full rounded-2xl bg-kid-violet py-3.5 text-center text-[17px] font-bold text-on-accent transition active:scale-[0.99]"
          >
            Add to Apple Calendar
          </a>
          <p className="mt-2 text-[15px] text-fg-3">One tap — that’s it.</p>
        </Card>

        <Card title="Google Calendar">
          <CopyButton primary on={copied === "google"} onClick={() => copy("google")} />
          <Steps
            items={[
              <>
                <b>Other calendars</b> → <b>+</b>
              </>,
              <>
                <b>From URL</b> → paste
              </>,
              <>
                <b>Add calendar</b>
              </>,
              <>
                On your phone: <b>☰</b> → <b>Settings</b> → <b>Show more</b> → switch this
                calendar on
              </>,
            ]}
          />
          <p className="mt-2 text-[15px] text-fg-3">
            Google only lets you subscribe from a computer, and a new calendar arrives switched off
            on the phone — usually hidden under “Show more” — so without the last step it looks like
            nothing happened. Google can take up to a day to send it to the phone at all.
          </p>
        </Card>

        <Card title="Outlook">
          <CopyButton primary on={copied === "outlook"} onClick={() => copy("outlook")} />
          <Steps
            items={[
              <>
                Open <b>outlook.office.com</b> → Calendar
              </>,
              <>
                <b>Add calendar</b> → <b>Subscribe from web</b>
              </>,
              <>Paste the address</>,
            ]}
          />
          <p className="mt-2 text-[15px] text-fg-3">
            Outlook for Mac can’t subscribe — its “Import ICS” takes a snapshot that never updates. Do
            it once on the web and it syncs down to the desktop app.
          </p>
        </Card>

        <Card title="Any other calendar">
          <CopyButton on={copied === "other"} onClick={() => copy("other")} />
          <p className="mt-2 text-[15px] text-fg-2">
            Look for <b>Subscribe</b>, <b>From URL</b> or <b>Add by URL</b> — never “Import”, which
            copies once and never updates.
          </p>
        </Card>
      </div>

      <p className="mt-5 break-all rounded-2xl bg-card p-3 text-[13px] text-fg-3">{feedUrl}</p>

      <p className="mt-4 text-[15px] text-fg-3">
        It shows up as its own calendar, refreshed by your calendar app — within an hour or so on
        Apple, about three hours on Outlook, and up to a day on Google. It won’t make you look busy
        to colleagues, and it doesn’t send notifications.
      </p>
    </main>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-3xl bg-card p-4">
      <h3 className="text-[19px] font-bold leading-tight">{title}</h3>
      {sub && <p className="mb-3 mt-0.5 text-[15px] text-fg-3">{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/**
 * `primary` marks the button that is *the* way to subscribe in that app, so it
 * carries the same weight as Apple's. The catch-all card stays quiet — it is a
 * fallback, not a route anyone arrives looking for.
 */
function CopyButton({ on, onClick, primary }: { on: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl py-3.5 text-[17px] transition active:scale-[0.99] ${
        primary ? "bg-kid-violet font-bold text-on-accent" : "bg-raised font-semibold text-fg"
      }`}
    >
      {on ? "Address copied ✓" : "Copy address"}
    </button>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-3 space-y-1 text-[15px] text-fg-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 tabular-nums text-fg-3">{i + 1}.</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

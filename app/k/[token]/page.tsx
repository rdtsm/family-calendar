import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { kidByToken, eventsInRange } from "@/lib/queries";
import { dayWindow, shiftDay, todayKey } from "@/lib/time";
import KidDay from "./KidDay";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const child = await kidByToken(token);
  const name = child?.name ?? "Calendar";

  // Derived from the request rather than configured, so the preview card works
  // on workers.dev, on a custom domain, and on anyone else's deployment.
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return {
    metadataBase: new URL(`${proto}://${host}`),
    title: child ? `${child.name}'s Day` : "Family Calendar",
    manifest: `/k/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: "default", title: name },
    robots: { index: false, follow: false },

    // What WhatsApp shows when the link is shared. noindex keeps it out of
    // search engines; it does not stop a chat app fetching the preview.
    openGraph: {
      type: "website",
      title: `${name}'s calendar`,
      description: "Your day, one tap away. Open it, then add it to your home screen.",
      // JPEG, and deliberately small: WhatsApp silently drops preview images
      // over roughly 600 KB, which is what the unoptimised PNG exceeded.
      images: [{ url: "/og.jpg", width: 1200, height: 630, type: "image/jpeg", alt: "Family Calendar" }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${name}'s calendar`,
      description: "Your day, one tap away.",
      images: ["/og.jpg"],
    },
  };
}

/** One day back so "yesterday" is reachable, a month forward so a 4-week
 *  booking is visible end to end. */
const DAYS_BACK = 1;
const DAYS_FORWARD = 28;

export default async function KidPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { token } = await params;
  const { d } = await searchParams;
  const child = await kidByToken(token);
  if (!child) notFound();

  const today = todayKey();

  // A notification links to the day it is about, so tapping "Piano on Thursday"
  // opens Thursday rather than today. Anything outside the loaded window is
  // ignored rather than shown as a blank day.
  const inWindow =
    !!d &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    d >= shiftDay(today, -DAYS_BACK) &&
    d <= shiftDay(today, DAYS_FORWARD - 1);
  const initialDay = inWindow ? d : today;

  const start = dayWindow(shiftDay(today, -DAYS_BACK)).start;
  const end = dayWindow(shiftDay(today, DAYS_FORWARD)).end;
  const events = await eventsInRange(child.id, start, end);

  return (
    <KidDay
      child={{ id: child.id, name: child.name, emoji: child.emoji, color: child.color, token: child.token }}
      events={events.map((e) => ({
        id: e.id,
        title: e.title,
        emoji: e.emoji,
        location: e.location,
        startsAt: new Date(e.starts_at).toISOString(),
        endsAt: new Date(e.ends_at).toISOString(),
        mine: e.created_by === "child",
        doneAt: e.done_at ? new Date(e.done_at).toISOString() : null,
      }))}
      today={today}
      initialDay={initialDay}
      daysBack={DAYS_BACK}
      daysForward={DAYS_FORWARD}
      // When this page is served from the cache offline, this is how old the
      // schedule on screen actually is.
      renderedAt={new Date().toISOString()}
    />
  );
}

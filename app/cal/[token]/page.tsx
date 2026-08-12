import type { Metadata } from "next";
import { headers } from "next/headers";
import { isParent } from "@/lib/auth";
import { childByToken } from "@/lib/queries";
import PinScreen from "@/app/parent/PinScreen";
import Subscribe from "./Subscribe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The handover page. This is what gets shared over WhatsApp, and it is gated by
 * the parent PIN so that a forwarded message on its own is inert — the feed
 * token it reveals is a different secret, so appending `.ics` to this URL leads
 * nowhere.
 *
 * The gate is the ordinary parent session rather than a bespoke one: the PIN is
 * the parent credential, so anyone who can pass this screen could sign in at
 * /parent regardless. A separate cookie would imply a separation that does not
 * exist.
 */
export default async function CalendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const person = await childByToken(token);
  if (!person || person.kind === "child") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 text-center">
        <p className="text-[19px] font-semibold">This link is no longer active.</p>
        <p className="mt-2 text-[17px] text-fg-2">Ask for a new one.</p>
      </main>
    );
  }

  if (!(await isParent())) {
    return <PinScreen next={`/cal/${token}`} lead={`Enter the family PIN to set up ${person.name}’s calendar.`} />;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const feedUrl = `${proto}://${host}/feed/${person.feed_token}.ics`;

  return <Subscribe name={person.name} feedUrl={feedUrl} kind={person.kind} />;
}

/**
 * The subscribe feed. Fetched unattended by Google, Apple and Microsoft
 * servers — there is no browser and no human, so this endpoint cannot be
 * behind any interactive gate. Its only protection is that the token is
 * unguessable and separate from the share link.
 */
import { buildCalendar } from "@/lib/ics";
import { feedEvents, personByFeedToken, touchFetched } from "@/lib/queries";
import { dayWindow, shiftDay, todayKey } from "@/lib/time";
import { HORIZON_WEEKS } from "@/lib/recurrence";

export const dynamic = "force-dynamic";

/** A month of context behind, and everything the series horizon reaches ahead. */
const DAYS_BACK = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const token = file.replace(/\.ics$/, "");

  const person = await personByFeedToken(token);
  if (!person || person.kind === "child") {
    return new Response("Not found", { status: 404 });
  }

  const today = todayKey();
  const start = dayWindow(shiftDay(today, -DAYS_BACK)).start;
  const end = dayWindow(shiftDay(today, HORIZON_WEEKS * 7)).end;
  const events = await feedEvents(person, start, end);

  // Recording the fetch is what turns "did they ever subscribe?" from a
  // question nobody can answer into a line on their profile.
  await touchFetched(person.id);

  return new Response(buildCalendar(`Family Calendar — ${person.name}`, events), {
    // Deliberately the same shape Google's own published feeds return. A
    // Content-Disposition filename invites a client to treat the response as a
    // download rather than a calendar, and "private" is a caching hint aimed at
    // browsers, not at the unattended fetchers that actually read this.
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { claim, sendToChild } from "@/lib/push";
import { LEADS, sendDueReminder } from "@/lib/reminders";

/** Local hour for the "here's your day" summary. */
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR || 7);
import { dayWindow, fmtTime, shiftDay, todayKey, TZ } from "@/lib/time";
import { insertEvents, listChildren, markMaterialised, seriesToExtend } from "@/lib/queries";
import { horizonDay, occurrencesOn, weeklyDays } from "@/lib/recurrence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}

async function run() {
  const now = new Date();
  // `claimed` counts events the ledger accepted, `sent` counts devices reached,
  // `failed` counts devices the push service rejected. A push that is accepted but
  // undeliverable is invisible by design, so everything we *can* observe is reported.
  const results = {
    leadClaimed: 0,
    leadSent: 0,
    leadFailed: 0,
    digestClaimed: 0,
    digestSent: 0,
    digestFailed: 0,
    errors: [] as string[],
    extended: 0,
  };
  const errors = new Set<string>();

  // --- Keep weekly repeats topped up -----------------------------------------
  // Appends only after materialised_through, never before it, so an occurrence
  // the parent deleted is not recreated and a second run does nothing.
  const horizon = horizonDay(todayKey(now));
  for (const s of await seriesToExtend(horizon)) {
    const days = weeklyDays(shiftDay(s.materialised_through, 7), horizon);
    if (!days.length) continue;

    await insertEvents(
      occurrencesOn(days, s.start_time, s.end_time).map((o) => ({
        childId: s.child_id,
        groupId: s.group_id,
        title: s.title,
        emoji: s.emoji,
        location: s.location,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        seriesId: s.id,
      })),
    );
    await markMaterialised(s.id, days[days.length - 1]);
    results.extended += days.length;
  }

  // --- Heads-up before an event starts -------------------------------------
  const soon = await sql<{
    id: string;
    title: string;
    emoji: string;
    location: string | null;
    starts_at: string;
    child_id: string;
    token: string;
  }>`
    select e.id, e.title, e.emoji, e.location, e.starts_at, e.child_id, c.token
    from events e join children c on c.id = e.child_id
    where c.kind = 'child'
      and e.done_at is null
      and e.starts_at > ${now.toISOString()}
      and e.starts_at <= ${new Date(now.getTime() + LEADS[0] * 60_000).toISOString()}
  `;

  for (const e of soon) {
    const r = await sendDueReminder(e, now);
    if (!r.claimed) continue;
    results.leadClaimed++;
    results.leadSent += r.sent;
    results.leadFailed += r.failed;
    r.errors.forEach((x) => errors.add(x));
  }

  // --- Morning summary ------------------------------------------------------
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(now));

  if (localHour === DIGEST_HOUR) {
    const today = todayKey(now);
    const { start, end } = dayWindow(today);

    for (const child of await listChildren()) {
      if (!(await claim(`digest:${child.id}:${today}`))) continue;
      results.digestClaimed++;

      const rows = await sql<{ title: string; emoji: string; starts_at: string }>`
        select title, emoji, starts_at from events
        where child_id = ${child.id} and starts_at >= ${start.toISOString()} and starts_at < ${end.toISOString()}
        order by starts_at
      `;

      const body = rows.length
        ? rows.map((r) => `${fmtTime(r.starts_at)} ${r.title}`).join(" · ")
        : "Nothing planned today 🎉";

      const r = await sendToChild(child.id, {
        title: `Good morning, ${child.name}`,
        body,
        url: `/k/${child.token}?d=${today}`,
        tag: `digest-${today}`,
      });
      results.digestSent += r.sent;
      results.digestFailed += r.failed;
      r.errors.forEach((x) => errors.add(x));
    }
  }

  results.errors = [...errors];
  return results;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await run()) });
}

export async function POST(req: Request) {
  return GET(req);
}

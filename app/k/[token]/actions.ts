"use server";

import { revalidatePath } from "next/cache";
import {
  deleteOwnEvent,
  insertEvents,
  kidByToken,
  ownEventCount,
  recordOpen,
  setChildLook,
  setDone,
} from "@/lib/queries";
import { ACCENT_NAMES, type AccentName } from "@/lib/colors";
import { emojiFor, firstGrapheme } from "@/lib/emoji";
import { dayWindow, wallToInstant } from "@/lib/time";
import { cookies } from "next/headers";

const DEVICE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-fc_device" : "fc_device";

/** Enough for a real day, low enough that a bored afternoon cannot fill the calendar. */
const DAILY_LIMIT = 10;
const TITLE_MAX = 40;

export async function toggleDoneAction(token: string, eventId: string, done: boolean) {
  const child = await kidByToken(token);
  if (!child) return { ok: false as const };
  await setDone(eventId, child.id, done);
  revalidatePath(`/k/${token}`);
  return { ok: true as const };
}

/** The token identifies the child, so a kid can only ever restyle themselves. */
export async function updateLookAction(token: string, emoji: string, color: string) {
  const child = await kidByToken(token);
  if (!child) return { ok: false as const };

  const chosen = firstGrapheme(emoji);
  if (!chosen || !ACCENT_NAMES.includes(color as AccentName)) return { ok: false as const };

  await setChildLook(child.id, chosen, color);
  revalidatePath(`/k/${token}`);
  return { ok: true as const };
}

/**
 * A child adding something of their own.
 *
 * Everything a child creates is a single hour on a single day: no repeats, no
 * end time to get wrong, no other members. The narrow shape is the point — the
 * kid's app is good because it is not an adult calendar, and a create form with
 * four fields would be the first step back into one.
 *
 * Their entries stay on their own screen. `allEventsInRange` filters to
 * 'parent', so nothing here reaches the parent agenda or an adult's feed.
 */
export async function addOwnEventAction(token: string, day: string, start: string, title: string) {
  const child = await kidByToken(token);
  if (!child) return { ok: false as const, error: "Not found" };

  const clean = title.trim().slice(0, TITLE_MAX);
  if (!clean) return { ok: false as const, error: "What is it?" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(start)) {
    return { ok: false as const, error: "Pick a time" };
  }

  const { start: dayStart, end: dayEnd } = dayWindow(day);
  if ((await ownEventCount(child.id, dayStart, dayEnd)) >= DAILY_LIMIT) {
    return { ok: false as const, error: "That is enough for one day" };
  }

  const startsAt = wallToInstant(day, start);
  await insertEvents([
    {
      childId: child.id,
      groupId: null,
      title: clean,
      emoji: emojiFor(clean),
      location: null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      seriesId: null,
      createdBy: "child",
    },
  ]);

  revalidatePath(`/k/${token}`);
  return { ok: true as const };
}

/** Only their own, and only what they added — enforced in the query, not here. */
export async function deleteOwnEventAction(token: string, eventId: string) {
  const child = await kidByToken(token);
  if (!child) return { ok: false as const };
  await deleteOwnEvent(eventId, child.id);
  revalidatePath(`/k/${token}`);
  return { ok: true as const };
}

/**
 * Records that this browser has opened the child's link.
 *
 * It lives in an action rather than in the page render because Next only
 * permits writing a cookie from an action or a route handler; attempting it
 * while rendering throws, and a swallowed error there means the count silently
 * stays at zero — which is exactly the failure this feature exists to avoid.
 *
 * Stores a random id and two timestamps. No address, no user agent, no country.
 */
export async function noteDeviceAction(token: string) {
  try {
    const child = await kidByToken(token);
    if (!child) return { ok: false as const };

    const jar = await cookies();
    let id = jar.get(DEVICE_COOKIE)?.value;
    if (!id || id.length < 16) {
      id = crypto.randomUUID();
      jar.set(DEVICE_COOKIE, id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    await recordOpen(id, child.id);
    return { ok: true as const };
  } catch {
    // A child's calendar must render whether or not this bookkeeping works.
    return { ok: false as const };
  }
}

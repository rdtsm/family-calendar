"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changePin, isParent, newToken, pinIsValid, startParentSession } from "@/lib/auth";
import { newId, type Kind } from "@/lib/db";
import { emojiFor } from "@/lib/emoji";
import { expand, horizonDay } from "@/lib/recurrence";
import {
  clearReminderLedger,
  confirmDevices,
  createChild,
  endSeriesGroup,
  forgetDevices,
  rotateFeedToken,
  deleteChild,
  deleteEvent,
  createSeries,
  endSeries,
  insertEvents,
  renameChild,
  rotateChildToken,
  updateEventGroup,
} from "@/lib/queries";
import { clearFailures, lockedFor, recordFailure } from "@/lib/ratelimit";
import { childById, eventById } from "@/lib/queries";
import { OUTER_LEAD, sendDueReminder } from "@/lib/reminders";
import { dayKeyOf, minutesUntil, todayKey } from "@/lib/time";
import { after } from "next/server";

export type FormState = { error?: string; ok?: string };

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  // A six-digit PIN is 900k guesses. Without a lockout that is hours of work
  // for anyone who finds the URL, so the gate comes before the comparison.
  const wait = await lockedFor();
  if (wait > 0) return { error: `Too many attempts. Try again in ${wait} min.` };

  const pin = String(form.get("pin") ?? "");
  if (!(await pinIsValid(pin))) {
    await recordFailure();
    return { error: "Wrong PIN" };
  }

  await clearFailures();
  await startParentSession();
  // Only same-origin paths, so the PIN screen can never be used to bounce
  // somebody to another site.
  const next = String(form.get("next") ?? "");
  redirect(/^\/[^/\\]/.test(next) ? next : "/parent");
}

async function requireParent() {
  if (!(await isParent())) throw new Error("Not signed in");
}

export async function addEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();

  // Several members can be on one activity. Each gets their own row, sharing a
  // group id — the same expand-at-write-time choice recurrence already makes.
  const childIds = form.getAll("childId").map(String).filter(Boolean);
  const title = String(form.get("title") ?? "").trim();
  const day = String(form.get("day") ?? "");
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  const location = String(form.get("location") ?? "").trim() || null;
  const weekly = String(form.get("weekly") ?? "") === "1";

  if (!childIds.length) return { error: "Pick who it is for" };
  if (!title) return { error: "Add a title" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Pick a date" };
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { error: "Pick a start and end time" };

  const emoji = emojiFor(title);
  const today = todayKey();
  const occurrences = expand(day, start, end, weekly, today);
  if (!occurrences.length) return { error: "That date is beyond the calendar\u2019s horizon" };

  const groupId = childIds.length > 1 ? newId() : null;
  const through = dayKeyOf(occurrences[occurrences.length - 1].startsAt);

  // The series row is what keeps the repeat alive: the scheduler tops it back
  // up to the horizon, so it never quietly runs out at week 13. One per member,
  // because the unique index that makes top-ups idempotent is per series.
  const rows: Parameters<typeof insertEvents>[0] = [];
  for (const childId of childIds) {
    const seriesId = weekly
      ? await createSeries({
          child_id: childId,
          group_id: groupId,
          title,
          emoji,
          location,
          start_time: start,
          end_time: end,
          materialised_through: through,
        })
      : null;
    for (const o of occurrences) {
      rows.push({ childId, groupId, title, emoji, location, startsAt: o.startsAt, endsAt: o.endsAt, seriesId });
    }
  }
  const ids = await insertEvents(rows);

  // An activity added while it is already inside a reminder window would
  // otherwise wait for the next scheduler tick — which for something starting
  // in three minutes may never come before it starts. Firing here closes that,
  // and the shared ledger means the scheduler will not repeat it.
  const first = occurrences[0].startsAt;
  if (minutesUntil(first) > 0 && minutesUntil(first) <= OUTER_LEAD) {
    after(async () => {
      for (const [i, childId] of childIds.entries()) {
        try {
          const child = await childById(childId);
          // Adults have no device to push to; their calendar is the reminder.
          if (!child || child.kind !== "child") continue;
          const r = await sendDueReminder({
            id: ids[i * occurrences.length],
            title,
            emoji,
            location,
            starts_at: first.toISOString(),
            child_id: childId,
            token: child.token,
          });
          if (r.errors.length) console.error(`immediate reminder: ${r.errors.join(", ")}`);
        } catch (err) {
          console.error("immediate reminder failed", err);
        }
      }
    });
  }


  revalidatePath("/parent");
  revalidatePath("/k", "layout");
  return { ok: weekly ? "Added, every week" : "Added" };
}

/**
 * Corrects an activity already on the calendar: what, when, where.
 *
 * Not who, and not the repeat. Both are structural — who means adding and
 * removing rows of a group, the repeat means creating or ending a series — and
 * both stay delete-and-re-add, which already handles them. This is the
 * correction a rushed household actually makes: the wrong time, or a typo.
 *
 * A repeat is edited one occurrence at a time. The form says so before you
 * press Save, so nobody presses it expecting every Tuesday to move.
 */
export async function editEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();

  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const day = String(form.get("day") ?? "");
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  const location = String(form.get("location") ?? "").trim() || null;

  if (!id) return { error: "Unknown activity" };
  if (!title) return { error: "Add a title" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Pick a date" };
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { error: "Pick a start and end time" };

  const today = todayKey();
  // Past the horizon the agenda simply stops loading, so a move out there would
  // read as the activity having been deleted. Creating a one-off out there is
  // still allowed and has the same effect — an older gap, left alone rather than
  // widened into this change.
  if (day > horizonDay(today)) return { error: "That date is beyond the calendar’s horizon" };

  const before = await eventById(id);
  if (!before || before.created_by !== "parent") return { error: "That activity is no longer there" };

  // One occurrence, through the same expansion the create path uses, so the
  // past-midnight rule and the daylight-saving conversion are inherited rather
  // than restated here and allowed to disagree.
  const [when] = expand(day, start, end, false, today);
  const moved = when.startsAt.getTime() !== new Date(before.starts_at).getTime();
  const emoji = emojiFor(title);

  let ids: string[];
  try {
    ids = await updateEventGroup(id, {
      title,
      emoji,
      location,
      startsAt: when.startsAt,
      endsAt: when.endsAt,
      clearDone: moved,
    });
  } catch (err) {
    // (series_id, starts_at) is unique. The only way to hit it is to move one
    // occurrence of a repeat exactly onto another occurrence of the same one.
    if (/unique/i.test(String(err))) return { error: "There is already one at that time" };
    throw err;
  }
  if (!ids.length) return { error: "That activity is no longer there" };

  if (moved) {
    await clearReminderLedger(ids);

    // Same reasoning as creation: an activity moved into a reminder window would
    // otherwise wait for a scheduler tick that may not come before it starts.
    // The ledger was just cleared, so this is the announcement of the new time
    // rather than a repeat of the old one.
    if (minutesUntil(when.startsAt) > 0 && minutesUntil(when.startsAt) <= OUTER_LEAD) {
      after(async () => {
        for (const eventId of ids) {
          try {
            const ev = await eventById(eventId);
            if (!ev) continue;
            const child = await childById(ev.child_id);
            // Adults have no device to push to; their calendar is the reminder.
            if (!child || child.kind !== "child") continue;
            const r = await sendDueReminder({
              id: ev.id,
              title,
              emoji,
              location,
              starts_at: ev.starts_at,
              child_id: ev.child_id,
              token: child.token,
            });
            if (r.errors.length) console.error(`edited reminder: ${r.errors.join(", ")}`);
          } catch (err) {
            console.error("edited reminder failed", err);
          }
        }
      });
    }
  }

  revalidatePath("/parent");
  revalidatePath("/k", "layout");
  return { ok: "Saved" };
}

export async function deleteEventAction(form: FormData) {
  await requireParent();
  const id = String(form.get("id") ?? "");
  const seriesId = String(form.get("seriesId") ?? "");
  const scope = String(form.get("scope") ?? "one");

  // Forward-looking only: what already happened is history and stays, whether
  // one occurrence is removed or the whole repeat is stopped.
  if (scope === "series" && seriesId) await endSeriesGroup(seriesId, new Date());
  else if (id) await deleteEvent(id);

  revalidatePath("/parent");
  revalidatePath("/k", "layout");
}

const KINDS = new Set(["child", "participant", "observer"]);

export async function addChildAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();
  const name = String(form.get("name") ?? "").trim();
  const emoji = String(form.get("emoji") ?? "🙂").trim() || "🙂";
  const color = String(form.get("color") ?? "violet");
  const kind = String(form.get("kind") ?? "child");
  if (!name) return { error: "Name is required" };
  if (!KINDS.has(kind)) return { error: "Unknown role" };

  // Adults get a second secret: the share link is what you send them, the feed
  // token is what the PIN gate reveals. Without the split, appending .ics to a
  // leaked share link would walk straight past the gate.
  await createChild(name, emoji, color, newToken(), kind as Kind, kind === "child" ? null : newToken());
  revalidatePath("/parent", "layout");
  return { ok: `${name} added` };
}

export async function changePinAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();

  // Rate limited like the login: an intruder holding a session must not be able
  // to guess the current PIN in order to lock the real parent out.
  const wait = await lockedFor();
  if (wait > 0) return { error: `Too many attempts. Try again in ${wait} min.` };

  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "").trim();
  const confirm = String(form.get("confirm") ?? "").trim();

  // Asking for the current PIN is what stops an unattended logged-in device
  // being used to change the PIN and lock its owner out.
  if (!(await pinIsValid(current))) {
    await recordFailure();
    return { error: "Current PIN is wrong" };
  }
  if (!/^\d{4,10}$/.test(next)) return { error: "New PIN must be 4 to 10 digits" };
  if (next !== confirm) return { error: "The two new PINs do not match" };
  if (next === current.trim()) return { error: "That is already your PIN" };

  await clearFailures();
  await changePin(next);
  // Every session died with the epoch bump, including this one — reissue it so
  // the person who just changed it is not signed out by their own action.
  await startParentSession();

  revalidatePath("/parent", "layout");
  return { ok: "PIN changed. Every other signed-in device has been signed out." };
}

export async function renameChildAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!id) return { error: "Unknown child" };
  if (!name) return { error: "Name is required" };

  await renameChild(id, name);
  revalidatePath("/parent", "layout");
  return { ok: "Saved" };
}

export async function rotateLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Unknown child" };

  // Immediate, with no grace period for the old link: a rotation happens
  // because someone has a link they should not, and keeping it alive for
  // convenience would defeat the entire point.
  await rotateChildToken(id, newToken());
  // Both secrets go together. Rotating only the share link would leave a
  // leaked feed still syncing into somebody's calendar.
  const person = await childById(id);
  if (person && person.kind !== "child") await rotateFeedToken(id, newToken());

  revalidatePath("/parent", "layout");
  return { ok: "New link created. The old one no longer works." };
}

/**
 * Restarts the count. It revokes nothing: every link keeps working, and the
 * only thing that stops one is rotation. An earlier label ("forget these
 * devices") implied otherwise, which is the worst kind of wrong — a parent
 * could believe they had cut off a leaked link and be mistaken.
 *
 * It exists because the count drifts upward with ordinary use: private
 * browsing mints a new id every session, a new phone adds one. Being able to
 * zero it is what keeps the next number worth reading.
 */
export async function forgetDevicesAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireParent();
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Unknown child" };
  await forgetDevices(id);
  revalidatePath("/parent", "layout");
  return { ok: "Counting from now. The link itself still works." };
}

/**
 * Acknowledges every unconfirmed device for one child. It grants nothing and
 * blocks nothing — no link is bound to a device — it only stops the dashboard
 * reporting something the parent has already explained to themselves.
 */
export async function confirmDevicesAction(form: FormData) {
  await requireParent();
  const id = String(form.get("id") ?? "");
  if (id) await confirmDevices(id);
  revalidatePath("/parent", "layout");
}

export async function deleteChildAction(form: FormData) {
  await requireParent();
  const id = String(form.get("id") ?? "");
  if (id) await deleteChild(id);
  revalidatePath("/parent", "layout");
  redirect("/parent/kids");
}

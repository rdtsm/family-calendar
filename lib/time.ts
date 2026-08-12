import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** The one timezone the whole family lives in. Everything user-facing is rendered in it. */
export const TZ = process.env.NEXT_PUBLIC_FAMILY_TZ || "UTC";

/** A calendar day in the family timezone, e.g. "2026-08-04". */
export type DayKey = string;

/** Wall-clock date + time in the family timezone -> the real instant. */
export function wallToInstant(day: DayKey, time: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(TZDate.tz(TZ, y, m - 1, d, hh, mm, 0, 0).getTime());
}

/** The instant -> which family-timezone day it falls on. */
export function dayKeyOf(instant: Date | string): DayKey {
  return format(new TZDate(new Date(instant), TZ), "yyyy-MM-dd");
}

export function todayKey(now: Date = new Date()): DayKey {
  return dayKeyOf(now);
}

/**
 * Midnight UTC on that calendar day. A DayKey names a day, not an instant, so
 * arithmetic and formatting must both stay in UTC — never in the runtime's
 * local zone.
 *
 * This is not hypothetical tidiness. Building the anchor with Date.UTC and then
 * formatting it with a local-time formatter returns the *previous* day anywhere
 * west of Greenwich, while reading correctly at +8 and on
 * Workers (UTC). It shipped that way, and the only reason it was ever caught is
 * that someone ran the app from the Americas.
 */
function utcAnchor(day: DayKey): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function keyOf(anchor: Date): DayKey {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${anchor.getUTCFullYear()}-${p2(anchor.getUTCMonth() + 1)}-${p2(anchor.getUTCDate())}`;
}

export function shiftDay(day: DayKey, days: number): DayKey {
  const anchor = utcAnchor(day);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return keyOf(anchor);
}

/** Half-open [start, end) window covering one family-timezone day. */
export function dayWindow(day: DayKey): { start: Date; end: Date } {
  return { start: wallToInstant(day, "00:00"), end: wallToInstant(shiftDay(day, 1), "00:00") };
}

export function fmtTime(instant: Date | string): string {
  return format(new TZDate(new Date(instant), TZ), "HH:mm");
}

export function fmtDayLabel(day: DayKey, today: DayKey = todayKey()): string {
  if (day === today) return "Today";
  if (day === shiftDay(today, 1)) return "Tomorrow";
  if (day === shiftDay(today, -1)) return "Yesterday";
  return format(new TZDate(utcAnchor(day), "UTC"), "EEEE d MMM");
}

/** "Tuesday" — for describing which weekday a repeat lands on. */
export function fmtWeekdayLong(day: DayKey): string {
  return format(new TZDate(utcAnchor(day), "UTC"), "EEEE");
}

export function fmtWeekday(day: DayKey): string {
  return format(new TZDate(utcAnchor(day), "UTC"), "EEE");
}

export function dayOfMonth(day: DayKey): string {
  return day.split("-")[2].replace(/^0/, "");
}

/** Minutes from `from` until `instant`. Negative once it has passed. */
export function minutesUntil(instant: Date | string, from: Date = new Date()): number {
  return Math.round((new Date(instant).getTime() - from.getTime()) / 60000);
}

/** "just now" / "10 minutes ago" / "3 hours ago" / "2 days ago" */
export function fmtAgo(instant: Date | string, from: Date = new Date()): string {
  const mins = Math.max(0, Math.round((from.getTime() - new Date(instant).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** "in 25 min" / "in 2h 10m" / "now" */
export function humanCountdown(mins: number): string {
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `in ${Math.round(h / 24)}d`;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

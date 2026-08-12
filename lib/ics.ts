/**
 * iCalendar output for the subscribe feeds (RFC 5545).
 *
 * Everything here is a detail that is invisible when wrong: a calendar client
 * that dislikes the bytes does not report an error, it simply shows an empty
 * calendar. So each rule below is written out rather than assumed, and the unit
 * tests assert the exact bytes.
 */
import type { CalEvent } from "./db";

/** Escapes the four characters that are structural inside a TEXT value. */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Content lines are limited to 75 octets, continued by CRLF + one space.
 * Octets, not characters — an emoji is four bytes, and splitting one produces
 * mojibake or a parse failure, so the split is measured in UTF-8 bytes and
 * never lands inside a character.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75;
  for (let i = 0, seen = 0; i < line.length; i++) {
    const size = new TextEncoder().encode(line[i]).length;
    if (seen + size > limit) {
      out.push(line.slice(start, i));
      start = i;
      seen = 0;
      limit = 74; // continuation lines carry a leading space
    }
    seen += size;
  }
  out.push(line.slice(start));
  return out.join("\r\n ");
}

/** 2026-08-04T07:00:00.000Z -> 20260804T070000Z */
export function icsStamp(iso: string): string {
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
}

function vevent(e: CalEvent, stamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    // Stable and globally unique: event ids are UUIDs. A changed UID would
    // create a duplicate rather than update the entry.
    `UID:${e.id}@family-calendar`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsStamp(e.starts_at)}`,
    `DTEND:${icsStamp(e.ends_at)}`,
    `SUMMARY:${esc(`${e.emoji} ${e.title}`)}`,
  ];
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * A whole calendar. `now` is injectable so the tests are not time-dependent.
 *
 * REFRESH-INTERVAL and X-PUBLISHED-TTL are hints, not instructions: Apple
 * honours them, Google ignores them entirely and polls every 12-24 hours.
 */
export function buildCalendar(name: string, events: CalEvent[], now: Date = new Date()): string {
  const stamp = icsStamp(now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//family-calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((e) => vevent(e, stamp)),
    "END:VCALENDAR",
  ];
  // CRLF throughout, including a trailing one. Bare LF is the single most
  // common reason a feed parses nowhere.
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

import { test, expect } from "@playwright/test";
import { dayKeyOf, dayWindow, fmtAgo, fmtDayLabel, fmtTime, fmtWeekday, fmtWeekdayLong, humanCountdown, shiftDay, wallToInstant } from "../lib/time";
import { expand, weeklyDays, HORIZON_WEEKS } from "../lib/recurrence";
import { emojiFor, firstGrapheme, KID_PICKS, QUICK_PICKS } from "../lib/emoji";
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from "../lib/webpush";
import { buildCalendar } from "../lib/ics";
import type { CalEvent } from "../lib/db";

test.describe("time in the family timezone", () => {
  test("wall clock converts to the right instant (the suite runs the household at +8)", () => {
    expect(wallToInstant("2026-08-04", "15:00").toISOString()).toBe("2026-08-04T07:00:00.000Z");
  });

  test("an instant maps back to the local day, not the UTC day", () => {
    // 23:30 at +8 is still 15:30 UTC the same day...
    expect(dayKeyOf("2026-08-04T15:30:00.000Z")).toBe("2026-08-04");
    // ...but 07:00 at +8 on the 5th is 23:00 UTC on the 4th.
    expect(dayKeyOf("2026-08-04T23:00:00.000Z")).toBe("2026-08-05");
  });

  test("a day window is exactly 24h and starts at local midnight", () => {
    const { start, end } = dayWindow("2026-08-04");
    expect(start.toISOString()).toBe("2026-08-03T16:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("times render in local hours, zero-padded", () => {
    expect(fmtTime("2026-08-04T07:00:00.000Z")).toBe("15:00");
    // 00:11 local, not "0:11".
    expect(fmtTime("2026-08-03T16:11:00.000Z")).toBe("00:11");
    expect(fmtTime("2026-08-04T01:05:00.000Z")).toBe("09:05");
  });

  test("day arithmetic crosses month boundaries", () => {
    expect(shiftDay("2026-08-30", 7)).toBe("2026-09-06");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });

  test("elapsed time reads like a person wrote it", () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    expect(fmtAgo("2026-08-08T11:59:30.000Z", now)).toBe("just now");
    expect(fmtAgo("2026-08-08T11:50:00.000Z", now)).toBe("10 minutes ago");
    expect(fmtAgo("2026-08-08T11:00:00.000Z", now)).toBe("an hour ago");
    expect(fmtAgo("2026-08-08T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(fmtAgo("2026-08-07T12:00:00.000Z", now)).toBe("yesterday");
    expect(fmtAgo("2026-08-05T12:00:00.000Z", now)).toBe("3 days ago");
  });

  test("countdown reads like a person wrote it", () => {
    expect(humanCountdown(0)).toBe("now");
    expect(humanCountdown(25)).toBe("in 25 min");
    expect(humanCountdown(130)).toBe("in 2h 10m");
    expect(humanCountdown(120)).toBe("in 2h");
  });
});

test.describe("recurrence", () => {
  test("a weekly repeat lands on the same weekday for a year", () => {
    const out = expand("2026-08-04", "15:00", "16:00", true, "2026-08-04");
    expect(out).toHaveLength(HORIZON_WEEKS);
    expect(dayKeyOf(out[0].startsAt)).toBe("2026-08-04");
    expect(dayKeyOf(out[1].startsAt)).toBe("2026-08-11");
    // 51 weeks later, still a Tuesday and still 15:00.
    expect(dayKeyOf(out[51].startsAt)).toBe("2027-07-27");
    for (const o of out) expect(fmtTime(o.startsAt)).toBe("15:00");
  });

  test("once means once", () => {
    expect(expand("2026-08-04", "09:00", "10:00", false, "2026-08-04")).toHaveLength(1);
  });

  test("an end time before the start runs past midnight", () => {
    const [o] = expand("2026-08-04", "23:00", "00:30", false, "2026-08-04");
    expect(dayKeyOf(o.endsAt)).toBe("2026-08-05");
    expect(o.endsAt.getTime()).toBeGreaterThan(o.startsAt.getTime());
  });

  test("the top-up window only ever moves forward", () => {
    // What the scheduler computes: everything after the last date generated.
    expect(weeklyDays("2027-08-03", "2027-08-24")).toEqual([
      "2027-08-03",
      "2027-08-10",
      "2027-08-17",
      "2027-08-24",
    ]);
    // Already at the horizon — nothing to add, so re-running does nothing.
    expect(weeklyDays("2027-08-31", "2027-08-24")).toEqual([]);
  });
});

test.describe("emoji inference", () => {
  test("picks a matching icon without a picker", () => {
    expect(emojiFor("Boxing")).toBe("🥊");
    expect(emojiFor("boxing class")).toBe("🥊");
    expect(emojiFor("Piano lesson")).toBe("🎹");
    expect(emojiFor("Dentist")).toBe("🦷");
  });

  test("falls back to a neutral pin", () => {
    expect(emojiFor("Zzzblah")).toBe("📌");
  });

  test("every quick pick resolves to the icon shown on its chip", () => {
    // The chip only sets the title; the saved icon comes from emojiFor. If the
    // two disagree, the event is stored with a different icon than was tapped.
    for (const { title, emoji } of [...QUICK_PICKS, ...KID_PICKS]) {
      expect(emojiFor(title), `${title} should resolve to ${emoji}`).toBe(emoji);
    }
  });

  test("the kid's own topics do not collide with substrings", () => {
    // "read" hides in "bread" and "already"; "game" in "gamekeeper".
    expect(emojiFor("Reading")).toBe("📖");
    expect(emojiFor("Gaming")).toBe("🎮");
    expect(emojiFor("Bread making")).not.toBe("📖");
  });

  test("a short keyword does not match inside a longer word", () => {
    // "run" hides in brunch, "art" in party. Both shipped wrong before.
    expect(emojiFor("Brunch")).toBe("🥐");
    expect(emojiFor("Party")).toBe("🎉");
    expect(emojiFor("Running")).toBe("🏃");
    expect(emojiFor("Art class")).toBe("🎨");
  });

  test("a subject beats the generic rule that would otherwise catch it", () => {
    // First match wins, so placement is the whole design: below the tuition and
    // school rules, "Maths tuition" is 📚 and "Maths class" is 🎒.
    expect(emojiFor("Maths")).toBe("🧮");
    expect(emojiFor("Maths tuition")).toBe("🧮");
    expect(emojiFor("Maths class")).toBe("🧮");
    expect(emojiFor("Mathematics")).toBe("🧮");
    expect(emojiFor("Algebra revision")).toBe("🧮");

    expect(emojiFor("Drums")).toBe("🥁");
    expect(emojiFor("Drum lesson")).toBe("🥁");
    expect(emojiFor("Volleyball")).toBe("🏐");
    expect(emojiFor("Volleyball training")).toBe("🏐");
  });

  test("the added keywords do not catch words that merely start alike", () => {
    // "run" hid in brunch and "art" in party; both shipped wrong. These are
    // bounded for the same reason, and a family calendar is full of names.
    expect(emojiFor("Mathilda's party")).toBe("🎉");
    expect(emojiFor("Drummond pickup")).toBe("🚌");
  });

  test("the new lesson types are recognised in a sentence too", () => {
    expect(emojiFor("German class")).toBe("🇩🇪");
    expect(emojiFor("Chinese tuition")).toBe("🇨🇳");
    expect(emojiFor("Sunday brunch")).toBe("🥐");
  });
});

test.describe("the kid's chosen emoji", () => {
  test("keeps exactly one character", () => {
    expect(firstGrapheme("🦊")).toBe("🦊");
    expect(firstGrapheme("🦊🐼🦁")).toBe("🦊");
    expect(firstGrapheme("  🐧  ")).toBe("🐧");
  });

  test("treats multi-codepoint emoji as one character", () => {
    // ZWJ sequence and a regional-indicator flag must not be sliced in half.
    expect(firstGrapheme("👨‍👩‍👧")).toBe("👨‍👩‍👧");
    expect(firstGrapheme("🇲🇾")).toBe("🇲🇾");
  });

  test("rejects nothing to work with", () => {
    expect(firstGrapheme("")).toBeNull();
    expect(firstGrapheme("   ")).toBeNull();
  });
});


test.describe("web push crypto (RFC 8291 / 8292)", () => {
  // The worked example from RFC 8291 section 5 — these key values are published in
  // the RFC itself and are deliberately public. Reproducing the ciphertext byte-for-byte
  // is the only proof the encryption path is correct: a wrong implementation is
  // accepted by the push service with 201 Created and fails silently on the device.
  const RFC = {
    plaintext: "When I grow up, I want to be a watermelon",
    uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    authSecret: "BTBZMqHH6r4Tts7J_aSIgg", // gitleaks:allow published in RFC 8291 section 5
    asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", // gitleaks:allow published in RFC 8291 section 5
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    expected:
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };

  test("reproduces the RFC 8291 example byte for byte", async () => {
    const body = await encryptPayload({
      plaintext: new TextEncoder().encode(RFC.plaintext),
      uaPublic: b64urlDecode(RFC.uaPublic),
      authSecret: b64urlDecode(RFC.authSecret),
      salt: b64urlDecode(RFC.salt),
      asKeys: { publicKey: b64urlDecode(RFC.asPublic), privateKey: b64urlDecode(RFC.asPrivate) },
      recordSize: 4096,
    });

    expect(b64urlEncode(body)).toBe(RFC.expected);
  });

  test("a random send differs every time but keeps the frame shape", async () => {
    const args = {
      plaintext: new TextEncoder().encode("hello"),
      uaPublic: b64urlDecode(RFC.uaPublic),
      authSecret: b64urlDecode(RFC.authSecret),
    };
    const a = await encryptPayload(args);
    const b = await encryptPayload(args);

    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b)); // fresh salt and ephemeral key
    expect(a.length).toBe(b.length);
    // salt(16) + rs(4) + idlen(1) + as_public(65) + plaintext + delimiter + tag(16)
    expect(a.length).toBe(16 + 4 + 1 + 65 + 5 + 1 + 16);
    expect(a[20]).toBe(65); // the key-length byte
  });

  test("signs a VAPID header scoped to the push service origin", async () => {
    const header = await vapidAuthorization({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      subject: "mailto:test@example.test",
      publicKey: "BN--0nmGxD7hqZRLCoW_F2_BTynnkymNjUMY2YoIeWtre0YR841R5Auun1OoMDq1qbUNJ39ns4RRRfs38OMrmUc",
      privateKey: "OBSQPNLyaJp14dXmVSwcEdPtsoPrID4pwRwafxAfUxA", // gitleaks:allow test fixture, never used live
      now: Date.parse("2026-08-04T00:00:00Z"),
    });

    const [, jwt] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });

    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    expect(claims.aud).toBe("https://fcm.googleapis.com"); // origin only, no path
    expect(claims.sub).toBe("mailto:test@example.test");
    expect(claims.exp).toBeGreaterThan(Date.parse("2026-08-04T00:00:00Z") / 1000);

    // ES256 signatures are raw r‖s, 64 bytes — not DER.
    expect(b64urlDecode(sig).length).toBe(64);
  });
});

test.describe("iCalendar output", () => {
  const at = (starts: string, ends: string, over: Partial<CalEvent> = {}): CalEvent => ({
    id: "e1",
    child_id: "c1",
    title: "Boxing",
    emoji: "🥊",
    location: null,
    starts_at: starts,
    ends_at: ends,
    series_id: null,
    group_id: null,
    created_by: "parent",
    done_at: null,
    ...over,
  });
  const NOW = new Date("2026-08-04T09:00:00.000Z");

  test("a calendar with one event is byte-for-byte what a client expects", () => {
    const out = buildCalendar("Family", [at("2026-08-04T07:00:00.000Z", "2026-08-04T08:00:00.000Z")], NOW);
    expect(out).toBe(
      "BEGIN:VCALENDAR\r\n" +
        "VERSION:2.0\r\n" +
        "PRODID:-//family-calendar//EN\r\n" +
        "CALSCALE:GREGORIAN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "X-WR-CALNAME:Family\r\n" +
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n" +
        "X-PUBLISHED-TTL:PT1H\r\n" +
        "BEGIN:VEVENT\r\n" +
        "UID:e1@family-calendar\r\n" +
        "DTSTAMP:20260804T090000Z\r\n" +
        "DTSTART:20260804T070000Z\r\n" +
        "DTEND:20260804T080000Z\r\n" +
        "SUMMARY:🥊 Boxing\r\n" +
        "END:VEVENT\r\n" +
        "END:VCALENDAR\r\n",
    );
  });

  test("every line ends CRLF — a bare newline is the classic silent failure", () => {
    const out = buildCalendar("Family", [at("2026-08-04T07:00:00.000Z", "2026-08-04T08:00:00.000Z")], NOW);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("commas, semicolons and backslashes are escaped rather than ending the value", () => {
    const out = buildCalendar("F", [at("2026-08-04T07:00:00.000Z", "2026-08-04T08:00:00.000Z", {
      title: "Boxing, then dinner; bring C:\\gear",
    })], NOW);
    expect(out).toContain(String.raw`SUMMARY:🥊 Boxing\, then dinner\; bring C:\\gear`);
  });

  test("a long line folds, and never splits an emoji in half", () => {
    const out = buildCalendar("F", [at("2026-08-04T07:00:00.000Z", "2026-08-04T08:00:00.000Z", {
      title: "🥊".repeat(40),
    })], NOW);
    const folded = out.split("\r\n").find((l) => l.startsWith("SUMMARY"))!;
    expect(new TextEncoder().encode(folded).length).toBeLessThanOrEqual(75);
    // Unfolding restores the original: no character was cut through.
    const whole = out.slice(out.indexOf("SUMMARY")).split("\r\nEND:VEVENT")[0].replace(/\r\n /g, "");
    expect(whole).toBe(`SUMMARY:🥊 ${"🥊".repeat(40)}`);
  });

  test("an event that runs past midnight keeps its real end instant", () => {
    const out = buildCalendar("F", [at("2026-08-04T15:00:00.000Z", "2026-08-04T16:30:00.000Z")], NOW);
    expect(out).toContain("DTSTART:20260804T150000Z");
    expect(out).toContain("DTEND:20260804T163000Z");
  });

  test("location is included only when there is one", () => {
    const withLoc = buildCalendar("F", [at("2026-08-04T07:00:00.000Z", "2026-08-04T08:00:00.000Z", { location: "Club" })], NOW);
    const without = buildCalendar("F", [at("2026-08-04T07:00:00.000Z", "2026-08-04T08:00:00.000Z")], NOW);
    expect(withLoc).toContain("LOCATION:Club");
    expect(without).not.toContain("LOCATION");
  });
});

test.describe("day arithmetic is independent of where the runtime sits", () => {
  /**
   * A DayKey names a calendar day, not an instant. The original implementation
   * anchored at midnight UTC and then formatted with a local-time formatter,
   * which returns the previous day anywhere west of Greenwich — correct at
   * +8 and on Workers (UTC), wrong in the Americas. These assert
   * the values directly, so they hold whatever zone the suite runs in.
   */
  test("shifting by zero is the identity, not yesterday", () => {
    expect(shiftDay("2026-08-04", 0)).toBe("2026-08-04");
    expect(shiftDay("2026-01-01", 0)).toBe("2026-01-01");
    expect(shiftDay("2026-12-31", 0)).toBe("2026-12-31");
  });

  test("shifting crosses months, years and leap days", () => {
    expect(shiftDay("2026-08-04", 1)).toBe("2026-08-05");
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });

  test("a whole year of shifts round-trips", () => {
    for (let i = 0; i < 366; i++) {
      expect(shiftDay(shiftDay("2026-01-01", i), -i)).toBe("2026-01-01");
    }
  });

  test("weekday names match the day they are given", () => {
    // 2026-08-03 is a Monday. Rendered against a local formatter west of
    // Greenwich this said "Sunday 2 Aug".
    expect(fmtWeekdayLong("2026-08-03")).toBe("Monday");
    expect(fmtWeekday("2026-08-03")).toBe("Mon");
    expect(fmtDayLabel("2026-08-03", "2026-08-10")).toBe("Monday 3 Aug");
  });

  test("relative labels agree with the shift they are derived from", () => {
    const today = "2026-08-04";
    expect(fmtDayLabel(today, today)).toBe("Today");
    expect(fmtDayLabel(shiftDay(today, 1), today)).toBe("Tomorrow");
    expect(fmtDayLabel(shiftDay(today, -1), today)).toBe("Yesterday");
  });
});

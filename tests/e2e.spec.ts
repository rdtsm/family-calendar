import { test, expect, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { dayKeyOf, fmtDayLabel, fmtTime, shiftDay, todayKey } from "../lib/time";

const PIN = "246810";

/** The agenda and the kid's list both contain activity titles; the form contains
 *  quick-pick chips with the same words. Every assertion scopes to a named region. */
const agenda = (page: Page) => page.getByRole("region", { name: "Coming up" });
const schedule = (page: Page) => page.getByRole("list", { name: "Schedule" });
const kidsList = (page: Page) => page.getByRole("list", { name: "Family" });

async function unlock(page: Page) {
  await page.goto("/parent");
  if (await page.getByLabel("Family PIN").isVisible().catch(() => false)) {
    await page.getByLabel("Family PIN").fill(PIN);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  // Wait for something only the unlocked dashboard renders — the app title is on
  // the PIN screen too, so asserting it would pass before the login lands.
  await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();
}

async function ensureChild(page: Page, name: string) {
  return ensurePerson(page, name, "child");
}

/** kind picks which of the three add buttons is used. */
async function ensurePerson(page: Page, name: string, kind: "child" | "participant" | "observer") {
  const button =
    kind === "child" ? "+ Add child" : kind === "participant" ? "+ Add adult · taking part" : "+ Add adult · watching";
  const submit = kind === "child" ? "Add child" : "Add adult";

  await page.goto("/parent/kids");
  const row = kidsList(page).getByRole("listitem").filter({ hasText: name });
  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: button }).click();
    await page.getByPlaceholder("Name").fill(name);
    await page.getByRole("button", { name: submit, exact: true }).click();
    await expect(row).toHaveCount(1);
  }
  await page.goto("/parent");
  await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();
}

/** The absolute link shown on a child's profile page. */
async function kidLink(page: Page, name: string): Promise<string> {
  await page.goto("/parent/kids");
  await kidsList(page).getByRole("link", { name: new RegExp(name) }).click();
  // The absolute link is filled in on the client, so wait for the http form
  // rather than reading the relative placeholder.
  const link = page.getByRole("region", { name: "Their link" }).getByText(/^https?:\/\//);
  await expect(link).toBeVisible();
  const text = await link.innerText();
  await page.goto("/parent");
  return new URL(text.trim()).pathname;
}



async function addActivity(
  page: Page,
  opts: {
    child?: string;
    children?: string[];
    title: string;
    day: string;
    start: string;
    end: string;
    weekly?: boolean;
    where?: string;
  },
) {
  const form = page.locator("form").filter({ has: page.getByLabel("Activity") });

  // Who is a multi-select, so a click toggles. Set the exact membership rather
  // than assuming a click means "choose" — the first person starts selected.
  const want = opts.children ?? [opts.child!];
  const chips = form.getByRole("group", { name: "Who" }).getByRole("button");
  for (let i = 0; i < (await chips.count()); i++) {
    const chip = chips.nth(i);
    const label = ((await chip.textContent()) ?? "").trim();
    const wanted = want.some((w) => label.includes(w));
    const pressed = (await chip.getAttribute("aria-pressed")) === "true";
    if (wanted !== pressed) await chip.click();
  }
  await page.getByLabel("Activity").fill(opts.title);
  await page.getByLabel("Date").fill(opts.day);
  await page.getByLabel("Start time").fill(opts.start);
  await page.getByLabel("End time").fill(opts.end);
  if (opts.where) await page.getByPlaceholder("Club, school hall…").fill(opts.where);
  if (opts.weekly) await form.getByRole("button", { name: "Every week", exact: true }).click();

  const submit = opts.weekly ? "Add every week" : "Add to calendar";
  await form.getByRole("button", { name: submit }).click();
  await expect(page.getByRole("status")).toBeVisible();
}



/**
 * A slot a given number of minutes from now, with the date corrected if that
 * crosses midnight. Tests that hard-code a clock time pass by luck until the
 * suite runs at the wrong hour.
 */
function slotAround(minutes: number): { day: string; start: string; end: string } {
  // Read through the same helpers the app uses, so the slot is expressed in the
  // family timezone rather than in whatever zone the test runner happens to sit
  // in. Using local getters here silently disagreed with the server.
  const t = new Date(Date.now() + minutes * 60_000);
  return { day: dayKeyOf(t), start: fmtTime(t), end: fmtTime(new Date(t.getTime() + 60 * 60_000)) };
}

/**
 * A slot on today, whatever the hour. `slotAround` corrects the date when the
 * offset crosses midnight, which is right for creating an activity and wrong
 * for asserting it is on the child's screen — the child's screen opens on
 * today, so an activity pushed to tomorrow is simply not there.
 */
function todaySlot(hour: number): { day: string; start: string; end: string } {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { day: todayKey(), start: `${p2(hour)}:00`, end: `${p2(hour + 1)}:00` };
}

function dayPill(page: Page, day: string) {
  return page.getByRole("navigation", { name: "Days" }).getByRole("button", { name: fmtDayLabel(day) });
}

test.beforeEach(async ({ page }) => {
  await unlock(page);
  await ensureChild(page, "Beatrix");
});

test.describe("the mother plans the week", () => {
  test("the wrong PIN is rejected", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/parent");

    await page.getByLabel("Family PIN").fill("000000");
    await page.getByRole("button", { name: "Unlock" }).click();

    // Scoped by text: Next.js ships its own role="alert" route announcer.
    await expect(page.getByText("Wrong PIN")).toBeVisible();
    await expect(page.getByRole("region", { name: "Coming up" })).toBeHidden();
    await expect(page.getByLabel("Family PIN")).toBeVisible();
  });

  test("repeated wrong PINs lock the address out", async ({ page, context }) => {
    await context.clearCookies();
    // The limiter is per client address, and every other test shares one — so
    // this test claims its own, or it would lock the whole suite out.
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.7" });
    await page.goto("/parent");

    // Eight failures inside the window is the threshold.
    for (let i = 0; i < 8; i++) {
      await page.getByLabel("Family PIN").fill(String(100000 + i));
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page.getByText(/Wrong PIN|Too many attempts/)).toBeVisible();
    }

    // The ninth attempt is refused before the PIN is even compared — so the
    // correct PIN is rejected too, which is the point.
    await page.getByLabel("Family PIN").fill(PIN);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText(/Too many attempts/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Coming up" })).toBeHidden();
  });

  test("a weekly activity creates one event per week and reaches the kid's phone", async ({ page, context }) => {
    const day = todayKey();
    await addActivity(page, {
      child: "Beatrix",
      title: "Boxing",
      day,
      start: "15:00",
      end: "16:00",
      weekly: true,
      where: "Sports club",
    });

    await expect(page.getByRole("status")).toHaveText("Added, every week");
    await expect(agenda(page).getByText("Boxing")).toHaveCount(6);
    // The keyword rule picked the icon; the mother never opened a picker.
    await expect(agenda(page).getByText("🥊").first()).toBeVisible();

    // --- the kid's phone ---
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));

    await expect(kid.getByRole("heading", { name: "Hi Beatrix" })).toBeVisible();
    // Hero or list depending on the time of day — either counts as "she can see it".
    await expect(kid.getByText("Boxing").first()).toBeVisible();
    await expect(kid.getByText("15:00").first()).toBeVisible();
    await expect(kid.getByText("Sports club").first()).toBeVisible();

    // Three weeks out, same slot.
    await dayPill(kid, shiftDay(day, 21)).click();
    await expect(schedule(kid).getByText("Boxing")).toBeVisible();
    await kid.close();
  });

  test("changing the PIN signs out every other device", async ({ page, browser }) => {
    // A second device, already signed in — the intruder in the scenario this
    // feature exists for.
    const other = await browser.newContext({ baseURL: "http://localhost:3100" });
    const intruder = await other.newPage();
    await intruder.goto("/parent");
    await intruder.getByLabel("Family PIN").fill(PIN);
    await intruder.getByRole("button", { name: "Unlock" }).click();
    await expect(intruder.getByRole("region", { name: "Coming up" })).toBeVisible();

    await page.goto("/parent/settings");
    await page.getByLabel("Current PIN").fill(PIN);
    await page.getByLabel("New PIN", { exact: true }).fill("778899");
    await page.getByLabel("Repeat new PIN").fill("778899");
    await page.getByRole("button", { name: "Change PIN" }).click();
    await expect(page.getByRole("status")).toContainText("signed out");

    // The person who changed it stays in — their session was reissued.
    await page.goto("/parent");
    await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();

    // The other device is out, and its cookie is worthless: a signed cookie
    // from a superseded epoch must not be accepted.
    await intruder.reload();
    await expect(intruder.getByLabel("Family PIN")).toBeVisible();
    await expect(intruder.getByRole("region", { name: "Coming up" })).toBeHidden();

    // The old PIN no longer works; the new one does.
    await intruder.getByLabel("Family PIN").fill(PIN);
    await intruder.getByRole("button", { name: "Unlock" }).click();
    await expect(intruder.getByText("Wrong PIN")).toBeVisible();
    await intruder.getByLabel("Family PIN").fill("778899");
    await intruder.getByRole("button", { name: "Unlock" }).click();
    await expect(intruder.getByRole("region", { name: "Coming up" })).toBeVisible();

    // Put it back so the rest of the suite keeps working.
    await page.goto("/parent/settings");
    await page.getByLabel("Current PIN").fill("778899");
    await page.getByLabel("New PIN", { exact: true }).fill(PIN);
    await page.getByLabel("Repeat new PIN").fill(PIN);
    await page.getByRole("button", { name: "Change PIN" }).click();
    await expect(page.getByRole("status")).toContainText("signed out");
    await other.close();
  });

  test("two activities added back to back both survive", async ({ page }) => {
    // The form clears itself asynchronously on success. Adding a second activity
    // immediately afterwards must not be swallowed by that reset.
    await addActivity(page, { child: "Beatrix", title: "Fencing", day: todayKey(), start: "09:00", end: "10:00" });
    await addActivity(page, { child: "Beatrix", title: "Pottery", day: todayKey(), start: "11:00", end: "12:00" });

    await expect(agenda(page).getByText("Fencing")).toHaveCount(1);
    await expect(agenda(page).getByText("Pottery")).toHaveCount(1);
  });

  test("the delete box can be dismissed without deleting anything", async ({ page }) => {
    await addActivity(page, { child: "Beatrix", title: "Rowing", day: todayKey(), start: "07:00", end: "08:00" });
    const row = agenda(page).getByRole("listitem").filter({ hasText: "Rowing" }).first();

    // A one-off offers a single confirmation, not a choice of scope.
    await row.getByRole("button", { name: "Delete event" }).click();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "All events" })).toHaveCount(0);

    // The × keeps it.
    await row.getByRole("button", { name: "Don’t delete" }).click();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(agenda(page).getByText("Rowing")).toHaveCount(1);

    // So does tapping anywhere else.
    await row.getByRole("button", { name: "Delete event" }).click();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await page.getByRole("heading", { name: "Family Calendar" }).click();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(agenda(page).getByText("Rowing")).toHaveCount(1);
  });

  test("stopping a repeat removes what is still to come and keeps what already happened", async ({ page }) => {
    // Anchored two hours ago, so the first occurrence is in the past.
    const past = slotAround(-120);
    await addActivity(page, { child: "Beatrix", title: "Swimming", ...past, weekly: true });
    const before = await agenda(page).getByText("Swimming").count();
    expect(before).toBeGreaterThanOrEqual(5);

    const row = agenda(page).getByRole("listitem").filter({ hasText: "Swimming" }).first();
    await row.getByRole("button", { name: "Delete event" }).click();
    await row.getByRole("button", { name: "All events" }).click();

    // At most the single occurrence that already happened survives — deletion is
    // forward-looking. Whether there is one depends on whether two hours ago was
    // still today, so the assertion is a ceiling rather than an exact number.
    await expect
      .poll(() => agenda(page).getByText("Swimming").count())
      .toBeLessThanOrEqual(1);
  });

  test("deleting one occurrence leaves the rest", async ({ page }) => {
    const soon = slotAround(120);
    await addActivity(page, { child: "Beatrix", title: "Piano", ...soon, weekly: true });
    const before = await agenda(page).getByText("Piano").count();
    expect(before).toBeGreaterThanOrEqual(5);

    const row = agenda(page).getByRole("listitem").filter({ hasText: "Piano" }).first();
    await row.getByRole("button", { name: "Delete event" }).click();
    await row.getByRole("button", { name: "This event" }).click();

    // One gone, the rest untouched.
    await expect(agenda(page).getByText("Piano")).toHaveCount(before - 1);
  });

  test("each child gets their own link and sees only their own events", async ({ page, context }) => {
    await ensureChild(page, "Leo");
    await addActivity(page, { child: "Leo", title: "Football", day: todayKey(), start: "16:00", end: "17:00" });
    await expect(page.getByRole("status")).toHaveText("Added");

    const leoLink = await kidLink(page, "Leo");
    const beatrixLink = await kidLink(page, "Beatrix");
    expect(leoLink).not.toBe(beatrixLink);

    const leo = await context.newPage();
    await leo.goto(leoLink);
    await expect(leo.getByText("Football").first()).toBeVisible();
    await expect(leo.getByText("Boxing")).toHaveCount(0);
    await leo.close();
  });
});

/** The panel that opens in place of the row. Only ever one at a time. */
const editPanel = (page: Page) => page.getByRole("form", { name: "Edit activity" });

/**
 * Taps a row open and applies the changes given. The row locator is not reused
 * afterwards on purpose: once the panel replaces the line, the title lives in an
 * input's value and is no longer text anyone can filter on.
 */
async function editActivity(
  page: Page,
  title: string,
  changes: { title?: string; day?: string; start?: string; end?: string; where?: string },
  expectSaved = true,
) {
  await agenda(page).getByRole("button", { name: `Edit ${title}`, exact: true }).first().click();
  const panel = editPanel(page);
  await expect(panel).toBeVisible();

  if (changes.title !== undefined) await panel.getByLabel("Activity").fill(changes.title);
  if (changes.day !== undefined) await panel.getByLabel("Date").fill(changes.day);
  if (changes.start !== undefined) await panel.getByLabel("Start time").fill(changes.start);
  if (changes.end !== undefined) await panel.getByLabel("End time").fill(changes.end);
  if (changes.where !== undefined) await panel.getByPlaceholder("Club, school hall…").fill(changes.where);

  await panel.getByRole("button", { name: "Save changes" }).click();
  // Closing is the acknowledgement; a rejected save leaves it open with a reason.
  if (expectSaved) await expect(panel).toBeHidden();
}

/**
 * Reads an id straight out of the test database. The only way to name an event
 * the parent's screen deliberately never shows.
 */
function eventIdByTitle(title: string): string {
  const db = new DatabaseSync(".data-test/family.sqlite");
  try {
    const row = db
      .prepare("select id from events where title = ? order by created_at desc limit 1")
      .all(title)[0] as { id: string } | undefined;
    if (!row) throw new Error(`no event titled ${title}`);
    return row.id;
  } finally {
    db.close();
  }
}

test.describe("the mother corrects what she entered", () => {
  test("a wrong time is fixed in the row it sits in", async ({ page }) => {
    await addActivity(page, { child: "Beatrix", title: "Ballet", day: todayKey(), start: "09:00", end: "10:00" });
    await editActivity(page, "Ballet", { start: "11:00", end: "12:00", where: "Studio" });

    const row = agenda(page).getByRole("listitem").filter({ hasText: "Ballet" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("11:00–12:00");
    await expect(row).toContainText("Studio");
  });

  test("the correction reaches the child's app", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Hockey", day: todayKey(), start: "08:00", end: "09:00" });
    const link = await kidLink(page, "Beatrix");
    await editActivity(page, "Hockey", { title: "Hockey club", start: "13:00", end: "14:00" });

    const kid = await context.newPage();
    await kid.goto(link);
    const row = schedule(kid).getByRole("listitem").filter({ hasText: "Hockey club" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("13:00");
    await kid.close();
  });

  test("Cancel leaves it exactly as it was", async ({ page }) => {
    await addActivity(page, { child: "Beatrix", title: "Squash", day: todayKey(), start: "07:00", end: "08:00" });

    await agenda(page).getByRole("button", { name: "Edit Squash", exact: true }).click();
    await editPanel(page).getByLabel("Start time").fill("21:00");
    await editPanel(page).getByRole("button", { name: "Cancel" }).click();

    await expect(editPanel(page)).toHaveCount(0);
    await expect(agenda(page).getByRole("listitem").filter({ hasText: "Squash" })).toContainText("07:00–08:00");
  });

  test("correcting one week of a repeat leaves the other weeks alone", async ({ page }) => {
    const soon = slotAround(120);
    await addActivity(page, { child: "Beatrix", title: "Trampoline", ...soon, weekly: true });
    const before = await agenda(page).getByText("Trampoline").count();
    expect(before).toBeGreaterThanOrEqual(5);

    // The panel says as much before you press Save.
    await agenda(page).getByRole("button", { name: "Edit Trampoline", exact: true }).first().click();
    await expect(editPanel(page)).toContainText("part of a weekly repeat");
    await editPanel(page).getByLabel("Start time").fill("06:15");
    await editPanel(page).getByLabel("End time").fill("07:15");
    await editPanel(page).getByRole("button", { name: "Save changes" }).click();
    await expect(editPanel(page)).toBeHidden();

    // Same number of weeks, one of them moved.
    await expect(agenda(page).getByText("Trampoline")).toHaveCount(before);
    await expect(
      agenda(page).getByRole("listitem").filter({ hasText: "Trampoline" }).filter({ hasText: "06:15–07:15" }),
    ).toHaveCount(1);
  });

  test("a shared activity moves for everyone on it", async ({ page }) => {
    await ensureChild(page, "Rex");
    await addActivity(page, {
      children: ["Beatrix", "Rex"],
      title: "Violin",
      day: todayKey(),
      start: "16:00",
      end: "17:00",
    });
    await editActivity(page, "Violin", { start: "18:30", end: "19:30" });

    // One row per member behind the collapsed line, so the second member is the
    // one worth asking: moving only the row that was tapped would leave them
    // holding an appointment nobody else is at.
    for (const name of ["Beatrix", "Rex"]) {
      await agenda(page).getByRole("button", { name, exact: true }).click();
      await expect(agenda(page).getByRole("listitem").filter({ hasText: "Violin" })).toContainText("18:30–19:30");
    }
    await agenda(page).getByRole("button", { name: "All", exact: true }).click();
  });

  test("moving an activity un-ticks it", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Yoga", ...todaySlot(6) });

    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await schedule(kid).getByRole("listitem").filter({ hasText: "Yoga" }).getByRole("button").click();
    await kid.close();

    await page.goto("/parent");
    const row = agenda(page).getByRole("listitem").filter({ hasText: "Yoga" });
    await expect(row.getByText("DONE")).toBeVisible();

    // What was ticked off was the old slot. Carrying the tick over would tell
    // the parent something that never happened.
    await editActivity(page, "Yoga", { start: "19:45", end: "20:45" });
    await expect(agenda(page).getByRole("listitem").filter({ hasText: "Yoga" })).toContainText("19:45–20:45");
    await expect(agenda(page).getByRole("listitem").filter({ hasText: "Yoga" }).getByText("DONE")).toHaveCount(0);
  });

  test("a child's own entry offers no way in, and refuses a forged one", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Netball", day: todayKey(), start: "10:00", end: "11:00" });

    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await kid.getByRole("button", { name: "+ Add your own" }).click();
    const sheet = kid.getByRole("region", { name: "Add your own" });
    await sheet.getByRole("button", { name: /Playdate/ }).click();
    await sheet.getByRole("option", { name: "21:00" }).click();
    await sheet.getByRole("button", { name: "Add at 21:00" }).click();
    await expect(schedule(kid).getByText("Playdate")).toHaveCount(1);

    // It is not on the parent's screen, so there is nothing to tap.
    await page.goto("/parent");
    await expect(agenda(page).getByRole("button", { name: /^Edit Playdate$/ })).toHaveCount(0);

    // And naming it directly does not get past the action either: the filter
    // that hides it is the display rule, `created_by` is the actual boundary.
    const forged = eventIdByTitle("Playdate");
    await agenda(page).getByRole("button", { name: "Edit Netball", exact: true }).click();
    await editPanel(page).getByLabel("Start time").fill("05:30");
    // Last, and nothing after it that re-renders: the id is a controlled input,
    // so React restores it the moment any other field changes.
    await editPanel(page).locator('input[name="id"]').evaluate((el, id) => {
      (el as HTMLInputElement).value = id;
    }, forged);
    await editPanel(page).getByRole("button", { name: "Save changes" }).click();
    await expect(editPanel(page).getByRole("alert")).toHaveText("That activity is no longer there");

    // Untouched on the child's own screen.
    await kid.reload();
    await expect(schedule(kid).getByRole("listitem").filter({ hasText: "Playdate" })).toContainText("21:00");
    await kid.close();
  });

  test("moving one week onto another says so rather than failing", async ({ page }) => {
    await addActivity(page, { child: "Beatrix", title: "Skating", day: todayKey(), start: "05:00", end: "06:00", weekly: true });

    // Next week's occurrence already owns this slot, and (series_id, starts_at)
    // is unique — the one collision a single-occurrence edit can produce.
    await editActivity(page, "Skating", { day: shiftDay(todayKey(), 7) }, false);
    await expect(editPanel(page).getByRole("alert")).toHaveText("There is already one at that time");

    await editPanel(page).getByRole("button", { name: "Cancel" }).click();
    await expect(agenda(page).getByRole("listitem").filter({ hasText: "Skating" }).first()).toContainText("05:00–06:00");
  });
});

test.describe("the kid's day", () => {
  test("tapping an event marks it done, and it stays done", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Tuition", day: todayKey(), start: "11:00", end: "12:00" });

    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));

    const row = schedule(kid).getByRole("listitem").filter({ hasText: "Tuition" }).getByRole("button");
    await expect(row).toHaveAttribute("aria-pressed", "false");
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "true");

    await kid.reload();
    await expect(
      schedule(kid).getByRole("listitem").filter({ hasText: "Tuition" }).getByRole("button"),
    ).toHaveAttribute("aria-pressed", "true");

    // The mother can see it landed.
    await page.reload();
    await expect(agenda(page).getByRole("listitem").filter({ hasText: "Tuition" }).getByText("DONE")).toBeVisible();
    await kid.close();
  });

  test("an activity added by the parent appears without a reload", async ({ page, context }) => {
    test.setTimeout(90_000);
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await expect(kid.getByRole("heading", { name: "Hi Beatrix" })).toBeVisible();
    await expect(kid.getByText("Origami")).toHaveCount(0);

    // Parent adds it while the child's page sits open.
    await addActivity(page, { child: "Beatrix", title: "Origami", day: todayKey(), start: "20:00", end: "21:00" });

    // Bringing the app back to the front refetches — no reload by the child.
    await kid.bringToFront();
    await expect(kid.getByText("Origami").first()).toBeVisible({ timeout: 60_000 });

    // Removing it must clear it from the child's view just as readily.
    const row = agenda(page).getByRole("listitem").filter({ hasText: "Origami" }).first();
    await row.getByRole("button", { name: "Delete event" }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    await kid.bringToFront();
    await expect(kid.getByText("Origami")).toHaveCount(0, { timeout: 60_000 });
    await kid.close();
  });

  test("a free day says so rather than showing an empty list", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));

    // Nothing in this suite schedules 13 days out.
    await dayPill(kid, shiftDay(todayKey(), 13)).click();
    await expect(kid.getByText("Nothing planned")).toBeVisible();
    await kid.close();
  });

  test("the kid picks their own emoji and colour, and it sticks", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));

    const avatar = kid.getByRole("button", { name: "Change your emoji and colour" });
    await avatar.click();

    const look = kid.getByRole("region", { name: "Your look" });
    await look.getByRole("button", { name: "🐧" }).click();
    await look.getByRole("button", { name: "mint" }).click();
    await expect(look.getByRole("button", { name: "mint" })).toHaveAttribute("aria-pressed", "true");

    await look.getByRole("button", { name: "Done" }).click();
    await expect(look).toBeHidden();
    await expect(avatar).toHaveText("🐧");

    // Survives a reload, so it was written rather than only held in state.
    await kid.reload();
    await expect(kid.getByRole("button", { name: "Change your emoji and colour" })).toHaveText("🐧");

    // And the parent sees the child they actually recognise.
    await page.goto("/parent/kids");
    await expect(kidsList(page).getByRole("listitem").filter({ hasText: "Beatrix" })).toContainText("🐧");
    await kid.close();
  });

  test("one kid restyling themselves leaves their sibling alone", async ({ page, context }) => {
    await ensureChild(page, "Leo");
    const leo = await context.newPage();
    await leo.goto(await kidLink(page, "Leo"));

    const avatar = leo.getByRole("button", { name: "Change your emoji and colour" });
    await avatar.click();
    await leo.getByRole("region", { name: "Your look" }).getByRole("button", { name: "🦖" }).click();
    await expect(avatar).toHaveText("🦖");

    const beatrix = await context.newPage();
    await beatrix.goto(await kidLink(page, "Beatrix"));
    await expect(beatrix.getByRole("button", { name: "Change your emoji and colour" })).not.toHaveText("🦖");

    await leo.close();
    await beatrix.close();
  });

  test("a notification link opens the day it refers to", async ({ page, context }) => {
    const day = shiftDay(todayKey(), 3);
    await addActivity(page, { child: "Beatrix", title: "Karate", day, start: "16:00", end: "17:00" });

    const kid = await context.newPage();
    // This is the URL shape a notification carries.
    await kid.goto(`${await kidLink(page, "Beatrix")}?d=${day}`);

    await expect(kid.getByRole("heading", { level: 1, name: "Hi Beatrix" })).toBeVisible();
    await expect(kid.getByText(fmtDayLabel(day, todayKey()))).toBeVisible();
    await expect(schedule(kid).getByText("Karate")).toBeVisible();
    await kid.close();
  });

  test("a day outside the loaded window falls back to today", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(`${await kidLink(page, "Beatrix")}?d=2099-01-01`);
    await expect(kid.getByText("Today")).toBeVisible();
    await kid.close();
  });

  test("the list shows the whole day, including whatever is highlighted", async ({ page, context }) => {
    // The highlight only exists on today, so the activity has to be today and
    // either running or still to come. Ten minutes ago satisfies that at any
    // hour except the first ten minutes after midnight, where ten minutes ahead
    // is used instead — so there is no time of day at which this cannot run.
    const [hh, mm] = fmtTime(new Date()).split(":").map(Number);
    const justAfterMidnight = hh === 0 && mm < 10;
    await addActivity(page, {
      child: "Beatrix",
      title: "Cello",
      ...slotAround(justAfterMidnight ? 10 : -10),
    });

    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));

    // Whether the highlight shows what is happening now or what is next depends
    // on the time of day, so read its own title rather than assuming a label.
    // It must also appear in the list, or the day reads as having a gap.
    const highlight = kid.getByRole("region", { name: "Highlight" });
    await expect(highlight).toBeVisible();
    const title = await highlight.getByRole("heading", { level: 2 }).innerText();
    await expect(schedule(kid).getByText(title)).toHaveCount(1);
    await kid.close();
  });

  test("replacing a link kills the old one and keeps everything behind it", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Judo", day: todayKey(), start: "18:00", end: "19:00" });
    const oldLink = await kidLink(page, "Beatrix");

    // The child ticks something off, so there is history to lose.
    const before = await context.newPage();
    await before.goto(oldLink);
    await schedule(before).getByRole("listitem").filter({ hasText: "Judo" }).getByRole("button").click();
    await expect(
      schedule(before).getByRole("listitem").filter({ hasText: "Judo" }).getByRole("button"),
    ).toHaveAttribute("aria-pressed", "true");
    await before.close();

    await page.goto("/parent/kids");
    await kidsList(page).getByRole("link", { name: /Beatrix/ }).click();
    await page.getByRole("button", { name: "Replace this link" }).click();
    await page.getByRole("button", { name: "New link", exact: true }).click();
    // The parent is told what happened and, more usefully, what to do next —
    // a new link nobody has sent is not a link.
    const done = page.getByRole("status");
    await expect(done).toContainText("New link created");
    await expect(done).toContainText("Now send it to Beatrix");
    await expect(done).toContainText("stopped working immediately");

    // The old link is dead.
    const dead = await context.newPage();
    const res = await dead.goto(oldLink);
    expect(res?.status()).toBe(404);

    // Rotating the address alone left the old phone still receiving reminders,
    // because subscriptions are keyed to the child rather than to the token.
    await page.goto("/parent/kids");
    await kidsList(page).getByRole("link", { name: /Beatrix/ }).click();
    await expect(page.getByRole("region", { name: "Reminders" })).toContainText("Off");
    await dead.close();

    // The new one is a different URL, and everything behind it survived —
    // the activity and the fact she had already ticked it off.
    const newLink = await kidLink(page, "Beatrix");
    expect(newLink).not.toBe(oldLink);

    const after = await context.newPage();
    await after.goto(newLink);
    await expect(after.getByRole("heading", { name: "Hi Beatrix" })).toBeVisible();
    await expect(
      schedule(after).getByRole("listitem").filter({ hasText: "Judo" }).getByRole("button"),
    ).toHaveAttribute("aria-pressed", "true");
    await after.close();
  });

  test("the installed app keeps its identity when the link is replaced", async ({ page, request }) => {
    await ensureChild(page, "Bruno");
    const before = await kidLink(page, "Bruno");
    const idOf = async (link: string) =>
      (await (await request.get(`${link}/manifest.webmanifest`)).json()).id as string;

    const first = await idOf(before);
    // Chrome keys an installed app on `id`, falling back to start_url when there
    // is none — which is why a replaced link used to appear as a second icon.
    expect(first).not.toContain(before.split("/").pop());

    await page.goto("/parent/kids");
    await kidsList(page).getByRole("link", { name: /Bruno/ }).click();
    await page.getByRole("button", { name: "Replace this link" }).click();
    await page.getByRole("button", { name: "New link" }).click();
    await expect(page.getByRole("status")).toContainText("New link created");

    const after = await kidLink(page, "Bruno");
    expect(after).not.toBe(before);
    expect(await idOf(after)).toBe(first);
  });

  test("the PIN page says which app it guards, and what it leaves alone", async ({ page }) => {
    await page.goto("/parent/settings");
    // "Every device" read as though it might include the children's phones.
    await expect(page.getByRole("region", { name: "Change PIN" })).toContainText("guards this app");

    const untouched = page.getByRole("region", { name: "What a new PIN does not change" });
    await expect(untouched).toContainText("children's apps keep working");
    await expect(untouched).toContainText("Replace this link");
    await expect(untouched).toContainText("subscribed calendars keep updating");
    // The old copy told a parent to remove and re-add the child, which predates
    // rotation and would have destroyed their history.
    await expect(untouched).not.toContainText("add them again");
  });

  test("an unknown link is a friendly dead end, not a crash", async ({ page }) => {
    const res = await page.goto("/k/definitely-not-a-real-token");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Link not found")).toBeVisible();
  });

  test("one child's token cannot touch another child's events", async ({ page, request }) => {
    const beatrix = await kidLink(page, "Beatrix");
    // A kid page only ever renders its own child's rows; the token in the URL is
    // the only authority, and setDone() is scoped by child_id server-side.
    const res = await request.get(beatrix);
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain("Football");
  });
});

test.describe("adults and their subscribe feeds", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
  });

  /** The /cal/<token> path that gets shared. */
  async function sharePath(page: Page, name: string) {
    await page.goto("/parent/kids");
    await kidsList(page).getByRole("link", { name: new RegExp(name) }).click();
    const href = await page.getByRole("link", { name: "Open link" }).getAttribute("href");
    return href!;
  }

  /** The feed address, read off the PIN-gated handover page. */
  async function feedUrl(page: Page, name: string) {
    await page.goto(await sharePath(page, name));
    const webcal = await page.getByRole("link", { name: "Add to Apple Calendar" }).getAttribute("href");
    return webcal!.replace(/^webcal:/, "http:");
  }

  test("an adult taking part gets only the activities they are on", async ({ page, request }) => {
    await ensurePerson(page, "Iris", "participant");
    await addActivity(page, { child: "Beatrix", title: "Origami", ...slotAround(180) });
    await addActivity(page, { children: ["Beatrix", "Iris"], title: "Rowing", ...slotAround(240) });

    const ics = await (await request.get(await feedUrl(page, "Iris"))).text();
    expect(ics).toContain("Rowing");
    expect(ics).not.toContain("Origami");
  });

  test("an adult watching gets everything, and a shared activity only once", async ({ page, request }) => {
    await ensurePerson(page, "Oma", "observer");
    await ensurePerson(page, "Iris", "participant");
    await addActivity(page, { child: "Beatrix", title: "Kendo", ...slotAround(180) });
    await addActivity(page, { children: ["Beatrix", "Iris"], title: "Sailing", ...slotAround(240) });

    const ics = await (await request.get(await feedUrl(page, "Oma"))).text();
    expect(ics).toContain("Kendo");
    // Stored once per member, but a calendar must not show it twice.
    expect(ics.split("SUMMARY").filter((p) => p.includes("Sailing"))).toHaveLength(1);
  });

  test("the feed is valid iCalendar and says so in its headers", async ({ page, request }) => {
    await ensurePerson(page, "Lin", "observer");
    const res = await request.get(await feedUrl(page, "Lin"));
    expect(res.headers()["content-type"]).toContain("text/calendar");
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  test("the handover page asks for the PIN, and the feed token is not derivable from it", async ({
    page,
    context,
  }) => {
    await ensurePerson(page, "Opa", "observer");
    const shareUrl = await sharePath(page, "Opa");

    const stranger = await context.browser()!.newContext();
    const other = await stranger.newPage();
    await other.goto(shareUrl);
    await expect(other.getByLabel("Family PIN")).toBeVisible();

    // Appending .ics to the share link must lead nowhere — otherwise the gate
    // would be decorative.
    const guess = await other.request.get(`/feed/${shareUrl.split("/").pop()}.ics`);
    expect(guess.status()).toBe(404);
    await stranger.close();
  });

  test("the subscribe page offers every calendar app its own route", async ({ page }) => {
    await ensurePerson(page, "Onkel", "participant");
    await page.goto(await sharePath(page, "Onkel"));

    // Four equal cards. An earlier layout gave Apple a primary button and left
    // the rest as grey text under a floating copy button, which read as a
    // ranking rather than a choice.
    for (const app of ["Apple Calendar", "Google Calendar", "Outlook", "Any other calendar"]) {
      await expect(page.getByRole("region", { name: app })).toBeVisible();
    }
    // Each card that needs the address carries its own copy button.
    await expect(page.getByRole("button", { name: "Copy address" })).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Add to Apple Calendar" })).toHaveCount(1);
  });

  test("an adult cannot open the kids' app, and a kid has no feed", async ({ page, request }) => {
    await ensurePerson(page, "Nana", "participant");
    const adultToken = (await sharePath(page, "Nana")).split("/").pop()!;

    expect((await request.get(`/k/${adultToken}`)).status()).toBe(404);
    expect((await request.get(`/cal/${(await kidLink(page, "Beatrix")).split("/").pop()}`)).status()).toBe(200);
  });

  test("an activity for several people is one row, not one per person", async ({ page }) => {
    await ensurePerson(page, "Mama", "participant");
    await addActivity(page, { children: ["Beatrix", "Mama"], title: "Tandem", ...slotAround(300) });

    const rows = agenda(page).getByRole("listitem").filter({ hasText: "Tandem" });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Beatrix & Mama");
  });

  test("deleting a shared activity removes it for everyone", async ({ page, request }) => {
    await ensurePerson(page, "Papi", "participant");
    await addActivity(page, { children: ["Beatrix", "Papi"], title: "Curling", ...slotAround(300) });
    const url = await feedUrl(page, "Papi");
    expect(await (await request.get(url)).text()).toContain("Curling");

    await page.goto("/parent");
    const row = agenda(page).getByRole("listitem").filter({ hasText: "Curling" });
    await row.getByRole("button", { name: "Delete event" }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(agenda(page).getByText("Curling")).toHaveCount(0);
    expect(await (await request.get(url)).text()).not.toContain("Curling");
  });
});

test.describe("a kid adds their own", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
  });

  /** Opens the kid's app and adds one entry at the given half-hour slot. */
  async function addOwn(kid: Page, title: string, slot: string) {
    await kid.getByRole("button", { name: "+ Add your own" }).click();
    const sheet = kid.getByRole("region", { name: "Add your own" });
    await sheet.getByRole("button", { name: new RegExp(title) }).click();
    await sheet.getByRole("option", { name: slot }).click();
    await sheet.getByRole("button", { name: `Add at ${slot}` }).click();
    await expect(kid.getByRole("region", { name: "Add your own" })).toHaveCount(0);
  }

  test("what a kid adds shows on their own day", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await addOwn(kid, "Gaming", "17:00");
    await expect(schedule(kid).getByText("Gaming")).toHaveCount(1);
    await kid.close();
  });

  test("and stays off the parent's calendar", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await addOwn(kid, "Drawing", "18:00");
    await kid.close();

    await page.goto("/parent");
    await expect(agenda(page).getByText("Drawing")).toHaveCount(0);
  });

  test("an observer's feed does not carry it either", async ({ page, context, request }) => {
    await ensurePerson(page, "Tante", "observer");
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await addOwn(kid, "Reading", "19:00");
    await kid.close();

    await page.goto("/parent/kids");
    await kidsList(page).getByRole("link", { name: /Tante/ }).click();
    await page.goto((await page.getByRole("link", { name: "Open link" }).getAttribute("href"))!);
    const feed = (await page.getByRole("link", { name: "Add to Apple Calendar" }).getAttribute("href"))!;
    const ics = await (await request.get(feed.replace(/^webcal:/, "http:"))).text();
    expect(ics).not.toContain("Reading");
  });

  test("a kid can remove their own but not what a parent set", async ({ page, context }) => {
    // A title no other test uses: the suite shares one database, so a name
    // reused elsewhere silently doubles the count here.
    await addActivity(page, { child: "Beatrix", title: "Archery", ...todaySlot(7) });

    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await addOwn(kid, "Cycling", "20:00");

    // Their own carries a remove control; the parent's does not.
    await expect(kid.getByRole("button", { name: "Remove Cycling" })).toHaveCount(1);
    await expect(kid.getByRole("button", { name: "Remove Archery" })).toHaveCount(0);

    await kid.getByRole("button", { name: "Remove Cycling" }).click();
    await expect(schedule(kid).getByText("Cycling")).toHaveCount(0);
    await expect(schedule(kid).getByText("Archery")).toHaveCount(1);
    await kid.close();
  });

  test("the parent can see how many devices have opened the link", async ({ page, context }) => {
    await ensureChild(page, "Rosie");
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Rosie"));
    await expect(kid.getByRole("region", { name: "Highlight" }).or(kid.getByText("Nothing planned"))).toBeVisible();
    await kid.waitForTimeout(500); // the device is noted from the client, once per session
    await kid.close();

    await page.goto("/parent/kids");
    await kidsList(page).getByRole("link", { name: /Rosie/ }).click();
    const link = page.getByRole("region", { name: "Their link" });
    await expect(link.getByText(/\d+ browser/)).toBeVisible();

    await link.getByRole("button", { name: "Start counting again" }).click();
    await expect(link.getByText(/Counting from now/)).toBeVisible();
  });
});

test.describe("getting the app onto the phone", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
  });

  test("a browser is told to install, because reminders need it", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));

    // Playwright is never standalone, so this is the browser case: on iPhone
    // push does not exist at all until the app is on the home screen, and the
    // bell that would fix it is hidden precisely because it cannot work.
    const hint = kid.getByRole("region", { name: "Add to home screen" });
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("home screen");
    // Reminders work in the browser on Android, so the banner must not sell
    // installing as the way to get them — that sentence is true only on iPhone.
    await expect(hint).not.toContainText("remind you before things start");
    await expect(hint).toContainText("works when you have no signal");
    await kid.close();
  });

  test("the family manager can be handed to the other parent", async ({ page }) => {
    await page.goto("/parent/kids");
    const box = page.getByRole("region", { name: "Share this app" });
    // The bare domain redirects elsewhere, so the path is the whole point of
    // the box existing — and it is printed, not only copied, because a blocked
    // clipboard must not be a dead end.
    await expect(box).toContainText("/parent");
    // It is an instruction, not a credential. The PIN must never ride along.
    await expect(box).not.toContainText(PIN);
    await expect(box.getByRole("button", { name: "Share link" })).toBeVisible();
  });

  test("the parent app says how to install itself, without overselling it", async ({ page }) => {
    await page.goto("/parent");
    const hint = page.getByRole("region", { name: "Add to home screen" });
    await expect(hint).toBeVisible();
    // No service worker controls /parent by choice, and subscriptions are keyed
    // to a child, so neither offline nor reminders may be promised here.
    await expect(hint).not.toContainText("no signal");
    await expect(hint).not.toContainText("remind");
  });

  test("the hint is gone once the app is installed", async ({ page, browser }) => {
    const link = await kidLink(page, "Beatrix");
    // An installed app reports display-mode: standalone; emulate that.
    const installed = await browser.newContext();
    await installed.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q.includes("standalone") ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as never) : real(q);
    });
    const kid = await installed.newPage();
    await kid.goto(link);
    await expect(schedule(kid).or(kid.getByText("Nothing planned"))).toBeVisible();
    await expect(kid.getByRole("region", { name: "Add to home screen" })).toHaveCount(0);
    await installed.close();
  });
});

test.describe("the calendar without a network", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
  });

  test("the worker belongs to the child, not to the whole site", async ({ page, context }) => {
    const link = await kidLink(page, "Beatrix");
    const kid = await context.newPage();
    await kid.goto(link);
    await kid.waitForFunction(() => !!navigator.serviceWorker.controller);

    const scopes = await kid.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    );
    // Scoped to this child: one worker per child means one push subscription
    // per child, and a notification Android can credit to the installed app.
    expect(scopes).toContain(link);
    // And nothing left owning the origin, or the old subscription would survive
    // to deliver a duplicate of every reminder.
    expect(scopes).not.toContain("/");
    await kid.close();
  });

  test("the day survives losing the network, and says how old it is", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Kayaking", ...todaySlot(8) });

    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await expect(schedule(kid).getByText("Kayaking")).toHaveCount(1);

    // Wait for the worker to control the page, or nothing has been cached yet.
    await kid.waitForFunction(() => !!navigator.serviceWorker.controller);
    await kid.reload();
    await expect(schedule(kid).getByText("Kayaking")).toHaveCount(1);
    await kid.waitForFunction(async () => {
      const cache = await caches.open("pages-v1");
      return !!(await cache.match(location.href));
    });

    await context.setOffline(true);
    await kid.addInitScript(() => Object.defineProperty(navigator, "onLine", { get: () => false }));
    await kid.reload();

    // Served from cache rather than the browser's offline page.
    await expect(schedule(kid).getByText("Kayaking")).toHaveCount(1);
    // And unmistakably a snapshot: a cached day that looks live is worse than none.
    await expect(kid.getByRole("region", { name: "Offline" })).toBeVisible();
    await expect(kid.getByRole("region", { name: "Offline" })).toContainText("may have changed");

    await context.setOffline(false);
    await kid.close();
  });

  test("offline hides the controls that need a server", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await expect(kid.getByRole("button", { name: "+ Add your own" })).toBeVisible();
    await kid.waitForFunction(() => !!navigator.serviceWorker.controller);
    await kid.reload();
    await kid.waitForFunction(async () => {
      const cache = await caches.open("pages-v1");
      return !!(await cache.match(location.href));
    });

    await context.setOffline(true);
    await kid.addInitScript(() => Object.defineProperty(navigator, "onLine", { get: () => false }));
    await kid.reload();
    await expect(kid.getByRole("region", { name: "Offline" })).toBeVisible();
    // Adding would fail; offering it and failing is worse than not offering it.
    await expect(kid.getByRole("button", { name: "+ Add your own" })).toHaveCount(0);

    await context.setOffline(false);
    await kid.close();
  });

  test("online, nothing is served from cache", async ({ page, context }) => {
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Beatrix"));
    await kid.waitForFunction(() => !!navigator.serviceWorker.controller);

    // An activity added after the page was cached must appear on reload, which
    // it cannot if the worker is answering documents from its cache.
    await addActivity(page, { child: "Beatrix", title: "Abseiling", ...todaySlot(9) });
    await kid.reload();
    await expect(schedule(kid).getByText("Abseiling")).toHaveCount(1);
    await expect(kid.getByRole("region", { name: "Offline" })).toHaveCount(0);
    await kid.close();
  });
});

test.describe("offline, arriving from a reminder", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
  });

  test("a notification's deep link opens offline, query string and all", async ({ page, context }) => {
    await addActivity(page, { child: "Beatrix", title: "Bouldering", ...todaySlot(10) });
    const link = await kidLink(page, "Beatrix");

    const kid = await context.newPage();
    await kid.goto(link);
    await kid.waitForFunction(() => !!navigator.serviceWorker.controller);
    await kid.reload();
    await kid.waitForFunction(async () => {
      const cache = await caches.open("pages-v1");
      return !!(await cache.match(location.pathname));
    });

    await context.setOffline(true);
    await kid.addInitScript(() => Object.defineProperty(navigator, "onLine", { get: () => false }));

    // Every reminder links to the day it is about, so this — not the bare link —
    // is how a child most often opens the app with no signal.
    await kid.goto(`${link}?d=${todayKey()}`);
    await expect(schedule(kid).getByText("Bouldering")).toHaveCount(1);
    await expect(kid.getByRole("region", { name: "Offline" })).toBeVisible();

    await context.setOffline(false);
    await kid.close();
  });
});

test.describe("a device the parent did not expect", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
  });

  /** Opens the kid link in a browser of its own, so it counts as a fresh device. */
  async function openOnNewDevice(browser: import("@playwright/test").Browser, link: string) {
    const ctx = await browser.newContext();
    const kid = await ctx.newPage();
    await kid.goto(link);
    await kid.waitForFunction(async () => {
      const r = await fetch(location.pathname, { method: "HEAD" });
      return r.ok;
    });
    await kid.waitForTimeout(700); // the device is noted from the client
    await ctx.close();
  }

  test("the first device is expected, so it says nothing", async ({ page, context }) => {
    await ensureChild(page, "Rosa");
    const kid = await context.newPage();
    await kid.goto(await kidLink(page, "Rosa"));
    await kid.waitForTimeout(700);
    await kid.close();

    await page.goto("/parent");
    await expect(page.getByRole("region", { name: "New device for Rosa" })).toHaveCount(0);
  });

  test("a second device is named, with what replacing the link would cost", async ({ page, browser }) => {
    await ensureChild(page, "Nils");
    const link = await kidLink(page, "Nils");
    await openOnNewDevice(browser, link);
    await openOnNewDevice(browser, link);

    await page.goto("/parent");
    const alert = page.getByRole("region", { name: "New device for Nils" });
    await expect(alert).toBeVisible();
    // The cost lands on the child, so it is stated before the tap, not after.
    await expect(alert).toContainText("send Nils the new link");
    await expect(alert.getByRole("link", { name: "Replace Nils's link" })).toBeVisible();
  });

  test("\"That was us\" clears it and it stays cleared", async ({ page, browser }) => {
    await ensureChild(page, "Ida");
    const link = await kidLink(page, "Ida");
    await openOnNewDevice(browser, link);
    await openOnNewDevice(browser, link);

    await page.goto("/parent");
    const alert = page.getByRole("region", { name: "New device for Ida" });
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "That was us" }).click();
    await expect(page.getByRole("region", { name: "New device for Ida" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("region", { name: "New device for Ida" })).toHaveCount(0);
  });
});

import { test, expect, type Page } from "@playwright/test";
import { todayKey } from "../lib/time";

/*
 * Layout, not behaviour.
 *
 * Ninety tests said the app worked while five people wrapped onto three rows on
 * the commonest Android phone and the two time fields read as one control. None
 * of them could have caught either: they assert what a control does, never how
 * much room it takes. These do, at a viewport pinned by hand rather than
 * inherited from the device profile, so a change of profile cannot move the
 * goalposts without someone noticing.
 */

const PIN = "246810";

/** The narrowest width in common use. Anything that fits here fits everywhere. */
const NARROW = 360;

async function unlock(page: Page) {
  await page.goto("/parent");
  if (await page.getByLabel("Family PIN").isVisible().catch(() => false)) {
    await page.getByLabel("Family PIN").fill(PIN);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();
}

async function seed(page: Page, names: string[]) {
  for (const name of names) {
    await page.goto("/parent/kids");
    const row = page.getByRole("list", { name: "Family" }).getByRole("listitem").filter({ hasText: name });
    if ((await row.count()) === 0) {
      await page.getByRole("button", { name: "+ Add child" }).click();
      await page.getByPlaceholder("Name").fill(name);
      await page.getByRole("button", { name: "Add child", exact: true }).click();
      await expect(row).toHaveCount(1);
    }
  }
}

/** The absolute link on a child's profile, which only the client fills in. */
async function kidLink(page: Page, name: string): Promise<string> {
  await page.goto("/parent/kids");
  await page.getByRole("list", { name: "Family" }).getByRole("link", { name: new RegExp(name) }).click();
  // Filled in on the client, so wait for the absolute form rather than reading
  // the relative placeholder that renders first.
  const link = page.getByRole("region", { name: "Their link" }).getByText(/^https?:\/\//);
  await expect(link).toBeVisible();
  return new URL((await link.innerText()).trim()).pathname;
}

test.describe("the form fits the phone it is used on", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: NARROW, height: 900 });
    await unlock(page);
    await seed(page, ["Beatrix", "Rex", "Rosie", "Nana", "Theo"]);
    await page.goto("/parent");
  });

  test("a family of five fits two rows of chips", async ({ page }) => {
    /*
     * Counting the rows on screen would measure the wrong thing: earlier specs
     * share this database, so by the time this runs the household is whatever
     * they left behind. Instead the five are measured individually and packed
     * the way flex-wrap packs — greedily, in order — which answers the question
     * asked without caring who else exists.
     *
     * Five used to take three rows at this width, and reclaiming card padding
     * alone did not fix it. Only narrower chips did.
     */
    const group = page.getByRole("group", { name: "Who" });
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (const name of ["Beatrix", "Rex", "Rosie", "Nana", "Theo"]) {
      const box = await group.getByRole("button", { name, exact: false }).first().boundingBox();
      expect(box, `${name} has no chip`).not.toBeNull();
      boxes.push(box!);
    }

    // Read the gap off the page rather than restating the class, so changing one
    // does not silently invalidate the other — but read it from the container's
    // own style rather than from the distance between two of these five. They
    // are only neighbours while nobody else is in the household: the first time
    // another fixture landed between them this measured 92px and failed a
    // layout that was correct.
    const gap = await group.evaluate((el) => parseFloat(getComputedStyle(el).columnGap) || 6);

    const inner = (await page.getByLabel("Date").locator("xpath=..").boundingBox())!.width;
    let rows = 1;
    let used = 0;
    for (const b of boxes) {
      const need = used === 0 ? b.width : used + gap + b.width;
      if (need > inner) {
        rows += 1;
        used = b.width;
      } else {
        used = need;
      }
    }
    expect(rows).toBeLessThanOrEqual(2);
  });

  test("nothing in the form overflows the card it sits in", async ({ page }) => {
    const card = await page.locator("section").filter({ hasText: "New activity" }).first().boundingBox();
    expect(card).not.toBeNull();
    const right = card!.x + card!.width;

    for (const label of ["Date", "Start time", "End time", "Activity"]) {
      const box = await page.getByLabel(label).boundingBox();
      expect(box, `${label} has no box`).not.toBeNull();
      expect(box!.x, `${label} starts left of the card`).toBeGreaterThanOrEqual(card!.x);
      expect(box!.x + box!.width, `${label} runs past the card`).toBeLessThanOrEqual(right + 1);
    }
  });

  test("the date pill fills its row, and its chevron follows the value", async ({ page }) => {
    // The pill spans the card; the input inside it is only as wide as the date,
    // so the browser's picker chevron lands beside the value rather than at the
    // far edge of the card. Relying on the input itself to stretch is what left
    // it ending mid-card on one Android browser.
    const pill = (await page.getByLabel("Date").locator("xpath=..").boundingBox())!;
    const input = (await page.getByLabel("Date").boundingBox())!;
    const activity = (await page.getByLabel("Activity").boundingBox())!;

    expect(pill.width).toBeGreaterThan(activity.width * 0.9);
    expect(input.width).toBeLessThan(pill.width * 0.75);
  });

  test("start and end are two fields, each labelled and each tappable", async ({ page }) => {
    const start = (await page.getByLabel("Start time").locator("xpath=..").boundingBox())!;
    const end = (await page.getByLabel("End time").locator("xpath=..").boundingBox())!;

    // Side by side, and genuinely apart — a visible gap is what stops the pair
    // reading as one control.
    expect(Math.abs(start.y - end.y)).toBeLessThan(4);
    expect(end.x).toBeGreaterThan(start.x + start.width);
    // Each says which it is, in its own right.
    await expect(page.getByText("Start", { exact: true })).toBeVisible();
    await expect(page.getByText("End", { exact: true })).toBeVisible();
    // Wide enough to hit, and to hold a time with its picker indicator.
    expect(start.width).toBeGreaterThan(100);
    expect(end.width).toBeGreaterThan(100);
  });

  test("the day's own gutters match the parent app's", async ({ page, context }) => {
    // The kid app paints its gutters on each block rather than padding one
    // container, so the single px-4 is five separate declarations there and
    // nothing but this would notice one of them drifting.
    const link = await kidLink(page, "Beatrix");
    const kid = await context.newPage();
    await kid.setViewportSize({ width: NARROW, height: 900 });
    await kid.goto(link);

    // These blocks are full-bleed with the gutter inside them, so the gutter is
    // the padding rather than the offset — read it directly.
    const gutters = await kid.evaluate(() =>
      ["header", 'nav[aria-label="Days"]', "footer"].map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return `${sel}: missing`;
        const s = getComputedStyle(el);
        return `${sel}: ${s.paddingLeft}/${s.paddingRight}`;
      }),
    );
    expect(gutters).toEqual([
      "header: 16px/16px",
      'nav[aria-label="Days"]: 16px/16px',
      "footer: 16px/16px",
    ]);

    // And the parent app's outer gutter is the same number.
    const parentGutter = await page.evaluate(() => getComputedStyle(document.querySelector("main")!).paddingLeft);
    expect(parentGutter).toBe("16px");
    await kid.close();
  });

  test("the edit panel fits the row it opens in", async ({ page }) => {
    // The correction form is the widest thing the agenda ever holds, and it is
    // nested one card deeper than the form it borrows its fields from.
    await page.getByLabel("Activity").fill("Fresco");
    await page.getByLabel("Date").fill(todayKey());
    await page.getByRole("button", { name: "Add to calendar" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page
      .getByRole("region", { name: "Coming up" })
      .getByRole("button", { name: "Edit Fresco", exact: true })
      .first()
      .click();

    const panel = page.getByRole("form", { name: "Edit activity" });
    const box = (await panel.boundingBox())!;
    for (const label of ["Activity", "Date", "Start time", "End time"]) {
      const b = (await panel.getByLabel(label).boundingBox())!;
      expect(b.x, `${label} starts left of the panel`).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width, `${label} runs past the panel`).toBeLessThanOrEqual(box.x + box.width + 1);
    }

    // Both ways out stay thumb-sized, and stacked rather than crowded — a
    // repeat puts two save buttons on that row, so Cancel cannot share it.
    const save = (await panel.getByRole("button", { name: "Save changes" }).boundingBox())!;
    const cancel = (await panel.getByRole("button", { name: "Cancel" }).boundingBox())!;
    expect(save.height).toBeGreaterThanOrEqual(42);
    expect(cancel.height).toBeGreaterThanOrEqual(42);
    expect(cancel.y).toBeGreaterThan(save.y + save.height - 1);
  });

  test("a repeat's two save buttons hold their words side by side", async ({ page }) => {
    await page.getByLabel("Activity").fill("Bocce");
    await page.getByLabel("Date").fill(todayKey());
    await page.getByRole("button", { name: "Every week", exact: true }).click();
    await page.getByRole("button", { name: "Add every week" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page
      .getByRole("region", { name: "Coming up" })
      .getByRole("button", { name: "Edit Bocce", exact: true })
      .first()
      .click();

    const panel = page.getByRole("form", { name: "Edit activity" });
    const week = (await panel.getByRole("button", { name: "Save this week" }).boundingBox())!;
    const all = (await panel.getByRole("button", { name: "Save all weeks" }).boundingBox())!;

    // Side by side, both tappable, and neither clipped by the panel it sits in.
    expect(Math.abs(week.y - all.y)).toBeLessThan(4);
    expect(all.x).toBeGreaterThan(week.x + week.width);
    expect(week.height).toBeGreaterThanOrEqual(42);
    expect(all.height).toBeGreaterThanOrEqual(42);

    // A button whose label has wrapped or overflowed is taller than one line of
    // padding allows — the failure two 17px labels would have produced here.
    expect(week.height).toBeLessThan(60);
    expect(all.height).toBeLessThan(60);
  });

  test("every chip stays big enough to hit", async ({ page }) => {
    // Denser chips must not become smaller targets: 44px is the floor both
    // Apple and Android publish, and the padding change was horizontal only.
    for (const chip of await page.getByRole("group", { name: "Who" }).getByRole("button").all()) {
      const box = (await chip.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(42);
    }
  });
});

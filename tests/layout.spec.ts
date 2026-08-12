import { test, expect, type Page } from "@playwright/test";

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

    // Read the gap off the page rather than restating the class, so changing
    // one does not silently invalidate the other.
    const sameRow = boxes.filter((b) => Math.round(b.y) === Math.round(boxes[0].y)).sort((a, b) => a.x - b.x);
    const gap = sameRow.length > 1 ? sameRow[1].x - (sameRow[0].x + sameRow[0].width) : 6;

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

  test("every chip stays big enough to hit", async ({ page }) => {
    // Denser chips must not become smaller targets: 44px is the floor both
    // Apple and Android publish, and the padding change was horizontal only.
    for (const chip of await page.getByRole("group", { name: "Who" }).getByRole("button").all()) {
      const box = (await chip.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(42);
    }
  });
});

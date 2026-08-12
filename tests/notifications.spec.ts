import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { dayKeyOf, fmtTime, todayKey } from "../lib/time";

/**
 * Writes an event straight to the test database, bypassing the create action.
 * The action now sends a reminder itself for anything already inside a lead
 * window, so this is the only way to hand the scheduler an event it has not
 * already seen — and the only way to place one at an exact offset.
 */
function insertEventDirect(childToken: string, minutesFromNow: number, title = "Direct") {
  const db = new DatabaseSync(".data-test/family.sqlite");
  try {
    const child = db.prepare("select id from children where token = ?").all(childToken)[0] as { id: string };
    const start = new Date(Date.now() + minutesFromNow * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    db.prepare(
      "insert into events (id, child_id, title, emoji, location, starts_at, ends_at) values (?,?,?,?,?,?,?)",
    ).run(randomUUID(), child.id, title, "📌", null, start.toISOString(), end.toISOString());
  } finally {
    db.close();
  }
}

const PIN = "246810";
const CRON_SECRET = "test-cron-secret";

const kidsList = (page: Page) => page.getByRole("list", { name: "Family" });

async function unlock(page: Page) {
  await page.goto("/parent");
  if (await page.getByLabel("Family PIN").isVisible().catch(() => false)) {
    await page.getByLabel("Family PIN").fill(PIN);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();
}

async function ensureChild(page: Page, name: string) {
  await page.goto("/parent/kids");
  const row = kidsList(page).getByRole("listitem").filter({ hasText: name });
  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: "+ Add child" }).click();
    await page.getByPlaceholder("Name").fill(name);
    await page.getByRole("button", { name: "Add child", exact: true }).click();
    await expect(row).toHaveCount(1);
  }
  await page.goto("/parent");
  await expect(page.getByRole("region", { name: "Coming up" })).toBeVisible();
}

/** The absolute link shown on a child's profile page. */
async function tokenFor(page: Page, name: string): Promise<string> {
  return (await kidLink(page, name)).replace("/k/", "");
}

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





/** Schedule something `mins` out so a given reminder window catches it. */
async function scheduleSoon(page: Page, child: string, title: string, mins = 40) {
  // Family-timezone wall clock, not the runner's — the two differ in this suite
  // by design, and local getters would put the activity on the wrong day.
  const soon = new Date(Date.now() + mins * 60_000);
  const start = fmtTime(soon);
  const end = fmtTime(new Date(soon.getTime() + 60 * 60_000));

  const form = page.locator("form").filter({ has: page.getByLabel("Activity") });
  await form.getByRole("button", { name: child, exact: true }).click();
  await page.getByLabel("Activity").fill(title);
  await page.getByLabel("Date").fill(dayKeyOf(soon));
  await page.getByLabel("Start time").fill(start);
  await page.getByLabel("End time").fill(end);
  await form.getByRole("button", { name: "Add to calendar" }).click();
  await expect(page.getByRole("status")).toHaveText("Added");
}

const cron = (request: APIRequestContext, key = CRON_SECRET) =>
  request.get(`/api/cron/reminders?key=${key}`);

test.describe("reminder endpoint", () => {
  test("refuses to run without the shared secret", async ({ request }) => {
    expect((await cron(request, "wrong-secret")).status()).toBe(401);
    expect((await request.get("/api/cron/reminders")).status()).toBe(401);
  });

  test("announces an upcoming event exactly once", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
    // Inserted directly: the create action would already have sent it.
    insertEventDirect(await tokenFor(page, "Beatrix"), 40, "Karate");

    const first = await cron(request);
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    // The event was picked up and claimed by the send-once ledger.
    expect(firstBody.leadClaimed).toBeGreaterThanOrEqual(1);

    // A second run in the same window must not re-announce it.
    const second = await (await cron(request)).json();
    expect(second.leadClaimed).toBe(0);
  });

  test("each lead fires once, and a late addition does not fire twice", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Nina");
    const token = await tokenFor(page, "Nina");

    // 40 minutes out: inside the hour window, outside the five.
    insertEventDirect(token, 40, "Cello");
    expect((await (await cron(request)).json()).leadClaimed).toBe(1);
    // Still 40 minutes out — the hour reminder must not repeat.
    expect((await (await cron(request)).json()).leadClaimed).toBe(0);

    // 3 minutes out satisfies both leads at once. Only the closest may fire,
    // and the wider one must be retired, or the next run would send it again.
    insertEventDirect(token, 3, "Harp");
    expect((await (await cron(request)).json()).leadClaimed).toBe(1);
    expect((await (await cron(request)).json()).leadClaimed).toBe(0);
  });

  test("an imminent new activity is claimed on creation, not left to the scheduler", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Ivo");

    // 20 minutes out: already inside the outer reminder window when created.
    await scheduleSoon(page, "Ivo", "Fencing", 20);

    // The create path fires it, so the scheduler finds nothing left to claim.
    // Without that, an activity added three minutes before it starts could be
    // missed entirely — the next tick may land after it has begun.
    const body = await (await cron(request)).json();
    expect(body.leadClaimed).toBe(0);
  });

  test("an activity beyond the outer window is left to the scheduler", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Ada");

    // Far out: nothing should fire yet, from either path.
    await scheduleSoon(page, "Ada", "Rowing", 300);
    expect((await (await cron(request)).json()).leadClaimed).toBe(0);
  });

  test("a device the push service rejects is counted, not swallowed", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Bruno");
    const token = await tokenFor(page, "Bruno");

    // A subscription that cannot possibly be delivered to.
    await request.post("/api/push/subscribe", {
      data: {
        token,
        subscription: {
          endpoint: "https://push.example.test/dead-endpoint",
          keys: {
            p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds", // gitleaks:allow invented fixture
            auth: "5I2Bu2oKdyy9CwL8QVF0NQ", // gitleaks:allow invented fixture for an unresolvable endpoint
          },
        },
      },
    });

    // Inserted directly so the scheduler is the one that sends it, and its
    // failure accounting is what we are measuring.
    insertEventDirect(token, 40, "Chess");
    const body = await (await cron(request)).json();

    expect(body.leadClaimed).toBeGreaterThanOrEqual(1);
    expect(body.leadSent).toBe(0);
    // The point of the change: the failure is visible from one call, not only
    // from a child who never got reminded.
    expect(body.leadFailed).toBeGreaterThanOrEqual(1);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

test.describe("push subscription", () => {
  test("the parent can see whether a child has reminders on", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Otto");
    const token = await tokenFor(page, "Otto");

    // No device registered yet.
    await page.goto("/parent/kids");
    const row = kidsList(page).getByRole("listitem").filter({ hasText: "Otto" });
    await expect(row).toContainText("Reminders off");
    await expect(page.getByRole("region", { name: "Coming up" })).toBeHidden();

    // The dashboard says so too, since that is where she actually looks.
    await page.goto("/parent");
    await expect(page.getByText(/Otto.*reminders off/i)).toBeVisible();

    await request.post("/api/push/subscribe", {
      data: {
        token,
        subscription: {
          endpoint: "https://push.example.test/otto-device",
          keys: { p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds", auth: "5I2Bu2oKdyy9CwL8QVF0NQ" }, // gitleaks:allow invented fixture
        },
      },
    });

    await page.goto("/parent/kids");
    await expect(kidsList(page).getByRole("listitem").filter({ hasText: "Otto" })).toContainText("Reminders on");
    await page.goto("/parent");
    await expect(page.getByText(/Otto.*reminders off/i)).toBeHidden();
  });

  test("rejects malformed and unknown-child payloads", async ({ request }) => {
    expect((await request.post("/api/push/subscribe", { data: {} })).status()).toBe(400);

    const bad = await request.post("/api/push/subscribe", {
      data: {
        token: "not-a-real-token",
        subscription: { endpoint: "https://example.test/x", keys: { p256dh: "a", auth: "b" } },
      },
    });
    expect(bad.status()).toBe(404);
  });

  test("stores a device once, even if the kid taps twice", async ({ page, request }) => {
    await unlock(page);
    await ensureChild(page, "Beatrix");
    const token = await tokenFor(page, "Beatrix");

    const body = {
      token,
      subscription: {
        endpoint: "https://push.example.test/endpoint-abc",
        keys: { p256dh: "key-p256dh", auth: "key-auth" },
      },
    };

    expect((await request.post("/api/push/subscribe", { data: body })).status()).toBe(200);
    // Re-subscribing upserts on the endpoint rather than duplicating the device.
    expect((await request.post("/api/push/subscribe", { data: body })).status()).toBe(200);
  });
});


import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./queries";

// __Host- forbids a Domain attribute, so no sibling subdomain can set or shadow
// this cookie. The prefix requires Secure, which plain-http localhost cannot
// satisfy consistently, so development falls back to the bare name.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-fc_parent" : "fc_parent";

const PIN_KEY = "parent_pin_hash";
const EPOCH_KEY = "session_epoch";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set.");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * The stored PIN is an HMAC keyed with SESSION_SECRET, which lives in the
 * deployment's secrets rather than the database. A six-digit PIN is only 900k
 * candidates, so a slow hash in the database would still be brute-forceable by
 * anyone holding a copy of it — keying with a secret they do not have is the
 * stronger arrangement, and it costs one fast operation rather than a hundred
 * thousand, which matters inside a Worker's CPU budget.
 *
 * Consequence worth knowing: rotating SESSION_SECRET invalidates the PIN, and
 * the deployment falls back to PARENT_PIN.
 */
function hashPin(pin: string): string {
  return createHmac("sha256", secret()).update(`pin:${pin.trim()}`).digest("hex");
}

/** Sessions carry the epoch they were issued under; bumping it revokes them all. */
async function currentEpoch(): Promise<string> {
  return (await getSetting(EPOCH_KEY)) ?? "1";
}

export async function pinIsValid(pin: string): Promise<boolean> {
  const stored = await getSetting(PIN_KEY);
  // Falls back to the environment until a PIN has been set from the app, so a
  // fresh deployment works with PARENT_PIN alone.
  if (!stored) {
    const env = process.env.PARENT_PIN;
    return !!env && safeEqual(pin.trim(), env);
  }
  return safeEqual(hashPin(pin), stored);
}

export async function startParentSession(): Promise<void> {
  const epoch = await currentEpoch();
  const jar = await cookies();
  jar.set(COOKIE, `${epoch}.${sign(epoch)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function isParent(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;

  const [epoch, mac] = raw.split(".");
  if (!epoch || !mac || !safeEqual(mac, sign(epoch))) return false;

  // A signed cookie from a superseded epoch is a session that has been revoked.
  return epoch === (await currentEpoch());
}

/**
 * Changing the PIN also revokes every existing session, including any the
 * person changing it did not create. Without that, a changed PIN would look
 * like a lockout and be none — sessions are signed with SESSION_SECRET and owe
 * nothing to the PIN.
 */
export async function changePin(next: string): Promise<void> {
  await setSetting(PIN_KEY, hashPin(next));
  await setSetting(EPOCH_KEY, String(Number(await currentEpoch()) + 1));
}

/** URL-safe, unguessable id for a child's private link. */
export function newToken(): string {
  return randomBytes(12).toString("base64url");
}

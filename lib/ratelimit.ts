import { headers } from "next/headers";
import { sql } from "./db";

/** Failures allowed inside one window before the address is locked out. */
const MAX_FAILURES = 8;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

async function clientIp(): Promise<string> {
  const h = await headers();
  // Cloudflare sets cf-connecting-ip at the edge and a client cannot forge it.
  // x-forwarded-for is client-controllable and is therefore only a development
  // fallback — in production cf-connecting-ip is always present and wins.
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

type Row = { failures: number; window_start: string; locked_until: string | null };

/** Minutes remaining on a lockout, or 0 if the address may try again. */
export async function lockedFor(now: Date = new Date()): Promise<number> {
  const ip = await clientIp();
  const rows = await sql<Row>`
    select failures, window_start, locked_until from login_attempts where ip = ${ip}
  `;
  const until = rows[0]?.locked_until;
  if (!until) return 0;

  const remaining = new Date(until).getTime() - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / 60_000) : 0;
}

export async function recordFailure(now: Date = new Date()): Promise<void> {
  const ip = await clientIp();
  const rows = await sql<Row>`
    select failures, window_start, locked_until from login_attempts where ip = ${ip}
  `;
  const row = rows[0];

  // A fresh window either because there is no row, or because the old one aged out.
  const stale = !row || now.getTime() - new Date(row.window_start).getTime() > WINDOW_MINUTES * 60_000;
  const failures = stale ? 1 : row.failures + 1;
  const windowStart = stale ? now.toISOString() : row.window_start;
  const lockedUntil =
    failures >= MAX_FAILURES ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString() : null;

  await sql`
    insert into login_attempts (ip, failures, window_start, locked_until)
    values (${ip}, ${failures}, ${windowStart}, ${lockedUntil})
    on conflict (ip) do update set
      failures = ${failures}, window_start = ${windowStart}, locked_until = ${lockedUntil}
  `;
}

export async function clearFailures(): Promise<void> {
  await sql`delete from login_attempts where ip = ${await clientIp()}`;
}

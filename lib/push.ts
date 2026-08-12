import { sql } from "./db";
import { sendPush, type Vapid } from "./webpush";

function vapid(): Vapid | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || "mailto:family@example.com" };
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/**
 * `sent` counts devices the push service accepted; `failed` counts the rest.
 * `errors` carries deduped reasons ("401", "gone", "vapid-not-configured") so a
 * misconfigured deployment is diagnosable from one call to the cron endpoint,
 * rather than only from a child not being reminded.
 */
export type SendResult = { sent: number; failed: number; errors: string[] };

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

export async function subscriptionsFor(childId: string): Promise<Sub[]> {
  return sql<Sub>`
    select id, endpoint, p256dh, auth from push_subscriptions where child_id = ${childId}
  `;
}

/** Sends to every device the child has registered. Dead endpoints are pruned. */
export async function sendToChild(childId: string, payload: PushPayload): Promise<SendResult> {
  const errors = new Set<string>();

  // Missing keys are a deployment error, not an absence of devices — say which.
  const keys = vapid();
  if (!keys) return { sent: 0, failed: 0, errors: ["vapid-not-configured"] };

  const subs = await subscriptionsFor(childId);
  let sent = 0;
  let failed = 0;

  for (const s of subs) {
    let status: number;
    try {
      status = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        keys,
      );
    } catch {
      // DNS, TLS or connection failure — the request never got a status.
      failed++;
      errors.add("transport");
      continue;
    }

    if (status >= 200 && status < 300) {
      sent++;
    } else if (status === 404 || status === 410) {
      // The browser threw the subscription away for good.
      await sql`delete from push_subscriptions where id = ${s.id}`;
      failed++;
      errors.add("gone");
    } else {
      // 401/403 is a bad VAPID key, 413 an oversized payload. All are silent to
      // the child, so record them rather than letting them disappear.
      failed++;
      errors.add(String(status));
    }
  }

  return { sent, failed, errors: [...errors] };
}

/** True if this is the first time we've claimed `key`. */
export async function claim(key: string): Promise<boolean> {
  const rows = await sql<{ key: string }>`
    insert into notifications_sent (key) values (${key})
    on conflict (key) do nothing
    returning key
  `;
  return rows.length > 0;
}

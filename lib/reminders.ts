import { claim, sendToChild, type SendResult } from "./push";
import { dayKeyOf, fmtTime, minutesUntil } from "./time";

/**
 * How long before an activity each reminder goes out, largest first. The cron
 * interval must be no longer than the smallest of these, or that window can
 * fall entirely between two runs and be missed with nothing to show for it.
 */
export const LEADS = (process.env.REMINDER_LEAD_MINUTES || "60,5")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => b - a);

/** The outermost reminder — beyond this, an activity is not yet imminent. */
export const OUTER_LEAD = LEADS[0] ?? 60;

export type DueEvent = {
  id: string;
  title: string;
  emoji: string;
  location: string | null;
  starts_at: string;
  child_id: string;
  token: string;
};

export type ReminderResult = SendResult & { claimed: boolean };

/**
 * Sends at most one reminder for an event: the closest lead that is due.
 *
 * Every lead at or above the remaining time is due at once — five minutes is
 * inside sixty — so an activity that appears twenty minutes before it starts
 * satisfies both. Firing only the closest keeps that to one notification, and
 * the wider leads are claimed silently because their moment has passed.
 *
 * Safe to call from the scheduler and from the moment an activity is created:
 * whichever runs first claims the ledger key, and the other does nothing.
 */
export async function sendDueReminder(e: DueEvent, now: Date = new Date()): Promise<ReminderResult> {
  const idle: ReminderResult = { claimed: false, sent: 0, failed: 0, errors: [] };

  const mins = minutesUntil(e.starts_at, now);
  if (mins <= 0) return idle;

  const due = LEADS.filter((lead) => mins <= lead).sort((a, b) => a - b);
  if (!due.length) return idle;

  const [closest, ...superseded] = due;
  if (!(await claim(`lead${closest}:${e.id}`))) return idle;

  const result = await sendToChild(e.child_id, {
    title: `${e.emoji} ${e.title}`,
    body: `Starts in ${Math.max(1, mins)} min · ${fmtTime(e.starts_at)}${e.location ? ` · ${e.location}` : ""}`,
    url: `/k/${e.token}?d=${dayKeyOf(e.starts_at)}`,
    tag: `event-${e.id}`,
  });

  for (const lead of superseded) await claim(`lead${lead}:${e.id}`);
  return { claimed: true, ...result };
}

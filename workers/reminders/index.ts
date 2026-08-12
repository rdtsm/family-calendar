/**
 * The scheduler. Cloudflare Cron Triggers invoke `scheduled()`, which the
 * Next.js worker does not export — so this is a separate five-line Worker whose
 * only job is to poke the reminder endpoint on a schedule.
 *
 * Keeping it separate means the schedule survives every application deploy, and
 * the reminder endpoint stays a plain authenticated URL that anything can call.
 */
type Env = { APP_URL: string; CRON_SECRET: string };

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    /*
     * Unset, this used to fetch `undefined/api/cron/reminders`: every reminder
     * stopped, and the only trace was a rejected invocation in `wrangler tail`,
     * which nobody reads until a child has already missed something. The
     * failure a deployment mistake produces should name the mistake.
     */
    if (!env.APP_URL) {
      throw new Error("APP_URL is not set — see workers/reminders/wrangler.jsonc. No reminder was sent.");
    }

    const res = await fetch(`${env.APP_URL}/api/cron/reminders`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });

    // Logged either way: a reminder run that reaches nobody should be visible in
    // `wrangler tail`, not inferred from a child who was never told.
    const body = await res.text();
    if (res.ok) console.log(`reminders ok ${body}`);
    else console.error(`reminders failed ${res.status} ${body}`);
  },
};

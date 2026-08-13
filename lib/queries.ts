import { newId, raw, sql, type CalEvent, type Child, type CreatedBy, type Kind } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const rows = await sql<{ value: string }>`select value from settings where key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await sql`
    insert into settings (key, value) values (${key}, ${value})
    on conflict (key) do update set value = ${value}
  `;
}

/** Everyone in the family, whatever their role. */
export async function listPeople(): Promise<Child[]> {
  return sql<Child>`
    select id, name, color, emoji, token, kind, feed_token, last_fetched_at, sort_order
    from children order by sort_order, name
  `;
}

/** Only the kids — the ones with an app and push reminders. */
export async function listChildren(): Promise<Child[]> {
  return (await listPeople()).filter((p) => p.kind === "child");
}

export async function childByToken(token: string): Promise<Child | null> {
  const rows = await sql<Child>`
    select id, name, color, emoji, token, kind, feed_token, last_fetched_at, sort_order
    from children where token = ${token} limit 1
  `;
  return rows[0] ?? null;
}

/**
 * The kid-app routes resolve through here rather than childByToken, so an
 * adult's share token can never open a child's app — the two token spaces
 * live in one column and only the kind separates them.
 */
export async function kidByToken(token: string): Promise<Child | null> {
  const person = await childByToken(token);
  return person && person.kind === "child" ? person : null;
}

export async function childById(id: string): Promise<Child | null> {
  const rows = await sql<Child>`
    select id, name, color, emoji, token, kind, feed_token, last_fetched_at, sort_order from children where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

export async function eventById(id: string): Promise<CalEvent | null> {
  const rows = await sql<CalEvent>`
    select id, child_id, title, emoji, location, starts_at, ends_at, series_id, group_id, created_by, done_at
    from events where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

export async function eventsInSeries(seriesId: string): Promise<CalEvent[]> {
  return sql<CalEvent>`
    select id, child_id, title, emoji, location, starts_at, ends_at, series_id, group_id, created_by, done_at
    from events where series_id = ${seriesId} order by starts_at
  `;
}

export async function eventsInRange(childId: string, start: Date, end: Date): Promise<CalEvent[]> {
  return sql<CalEvent>`
    select id, child_id, title, emoji, location, starts_at, ends_at, series_id, group_id, created_by, done_at
    from events
    where child_id = ${childId} and starts_at >= ${start.toISOString()} and starts_at < ${end.toISOString()}
    order by starts_at
  `;
}

/**
 * Everything a parent is meant to see: the whole household, minus whatever the
 * children added for themselves. This is the single place that rule is enforced
 * — the parent agenda and the adult feeds both read through here, so a kid's
 * entry cannot leak into either by someone forgetting a filter at the call site.
 */
export async function allEventsInRange(start: Date, end: Date): Promise<CalEvent[]> {
  return sql<CalEvent>`
    select id, child_id, title, emoji, location, starts_at, ends_at, series_id, group_id, created_by, done_at
    from events
    where created_by = 'parent'
      and starts_at >= ${start.toISOString()} and starts_at < ${end.toISOString()}
    order by starts_at
  `;
}

export type NewEvent = {
  childId: string;
  groupId: string | null;
  createdBy?: CreatedBy;
  title: string;
  emoji: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  seriesId: string | null;
};

/**
 * Returns the generated ids, in the order given.
 *
 * Written in chunks rather than one statement per row: a year of a weekly
 * series is 52 rows, and 52 round trips inside a form submission would be felt.
 * Ten rows is eighty bound parameters, comfortably inside D1's limit.
 *
 * `on conflict do nothing` against the unique (series_id, starts_at) index makes
 * this idempotent, so a top-up racing another one cannot double-insert.
 */
export async function insertEvents(rows: NewEvent[]): Promise<string[]> {
  const CHUNK = 10;
  const ids: string[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = batch
      .map((r) => {
        const id = newId();
        ids.push(id);
        values.push(id, r.childId, r.title, r.emoji, r.location, r.startsAt.toISOString(), r.endsAt.toISOString(), r.seriesId, r.groupId, r.createdBy ?? "parent");
        return "(?,?,?,?,?,?,?,?,?,?)";
      })
      .join(",");

    await raw(
      `insert into events (id, child_id, title, emoji, location, starts_at, ends_at, series_id, group_id, created_by)
       values ${placeholders} on conflict (series_id, starts_at) do nothing`,
      values,
    );
  }
  return ids;
}

export type Series = {
  id: string;
  child_id: string;
  group_id: string | null;
  title: string;
  emoji: string;
  location: string | null;
  start_time: string;
  end_time: string;
  materialised_through: string;
};

export async function createSeries(s: Omit<Series, "id"> & { materialised_through: string }): Promise<string> {
  const id = newId();
  await sql`
    insert into series (id, child_id, group_id, title, emoji, location, start_time, end_time, materialised_through)
    values (${id}, ${s.child_id}, ${s.group_id}, ${s.title}, ${s.emoji}, ${s.location},
            ${s.start_time}, ${s.end_time}, ${s.materialised_through})
  `;
  return id;
}

/** Open series whose runway has fallen short of the horizon. Usually none. */
export async function seriesToExtend(through: string): Promise<Series[]> {
  return sql<Series>`
    select id, child_id, group_id, title, emoji, location, start_time, end_time, materialised_through
    from series where active = 1 and materialised_through < ${through}
  `;
}

export async function markMaterialised(seriesId: string, through: string): Promise<void> {
  await sql`update series set materialised_through = ${through} where id = ${seriesId}`;
}

/** Stops a repeat and removes what has not happened yet. The past is history. */
export async function endSeries(seriesId: string, from: Date): Promise<void> {
  await sql`delete from events where series_id = ${seriesId} and starts_at >= ${from.toISOString()}`;
  await sql`update series set active = 0 where id = ${seriesId}`;
}

/**
 * One activity, however many members are on it. The rows of a group are the
 * same activity seen from each member, so removing it for one member only
 * would leave the others holding an appointment with nobody.
 */
export async function deleteEvent(id: string): Promise<void> {
  const rows = await sql<{ group_id: string | null }>`select group_id from events where id = ${id}`;
  const group = rows[0]?.group_id;
  if (group) await sql`delete from events where group_id = ${group}`;
  else await sql`delete from events where id = ${id}`;
}

export type EventPatch = {
  title: string;
  emoji: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  /** Moving an activity un-ticks it: what was done was the old one. */
  clearDone: boolean;
};

/**
 * Corrects one activity, however many members are on it — the same rule delete
 * follows, because the rows of a group are one activity seen from each member.
 *
 * `created_by = 'parent'` is the whole permission story from this side, the
 * mirror of `deleteOwnEvent`'s `created_by = 'child'`. A child's own entry never
 * reaches the parent's agenda in the first place; this makes reaching it
 * impossible rather than merely unlikely.
 *
 * Returns the ids actually changed — empty if the activity has since gone, or
 * if it was never the parent's to change.
 */
export async function updateEventGroup(id: string, p: EventPatch): Promise<string[]> {
  const found = await sql<{ id: string; group_id: string | null }>`
    select id, group_id from events where id = ${id} and created_by = 'parent'
  `;
  if (!found.length) return [];

  const group = found[0].group_id;
  const ids = group
    ? (
        await sql<{ id: string }>`
          select id from events where group_id = ${group} and created_by = 'parent'
        `
      ).map((r) => r.id)
    : [found[0].id];

  for (const target of ids) {
    await sql`
      update events
      set title = ${p.title}, emoji = ${p.emoji}, location = ${p.location},
          starts_at = ${p.startsAt.toISOString()}, ends_at = ${p.endsAt.toISOString()}
      where id = ${target}
    `;
    if (p.clearDone) await sql`update events set done_at = null where id = ${target}`;
  }
  return ids;
}

/**
 * Forgets that these events were announced, so a new time is announced again.
 *
 * Without it a reminder already sent keeps its claim under the event's id and
 * silences the corrected time — the move would reach the parent's screen and
 * never reach the child's. Matched on the id suffix rather than rebuilt from
 * LEADS, so changing the lead list cannot strand a claim nobody looks for.
 */
export async function clearReminderLedger(eventIds: string[]): Promise<void> {
  for (const id of eventIds) {
    await sql`delete from notifications_sent where key like ${`lead%:${id}`}`;
  }
}

/** Stops every member's copy of a repeat, forward-looking as always. */
export async function endSeriesGroup(seriesId: string, from: Date): Promise<void> {
  const rows = await sql<{ group_id: string | null }>`select group_id from series where id = ${seriesId}`;
  const group = rows[0]?.group_id;
  const ids = group
    ? (await sql<{ id: string }>`select id from series where group_id = ${group}`).map((r) => r.id)
    : [seriesId];
  for (const id of ids) await endSeries(id, from);
}

/** Kid taps an event: mark done, tap again to undo. Scoped to the child so a token can't touch siblings. */
/**
 * A child removing something they added themselves. Scoped by child *and* by
 * author, so a token can neither reach a sibling nor delete what a parent put
 * there — the two conditions are the whole permission model.
 */
export async function deleteOwnEvent(eventId: string, childId: string): Promise<void> {
  await sql`delete from events where id = ${eventId} and child_id = ${childId} and created_by = 'child'`;
}

/** How many a child has added for one day, for the daily cap. */
export async function ownEventCount(childId: string, start: Date, end: Date): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*) as n from events
    where child_id = ${childId} and created_by = 'child'
      and starts_at >= ${start.toISOString()} and starts_at < ${end.toISOString()}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Records that a browser opened a child's link. Deliberately stores nothing but
 * a random id and two timestamps: no address, no user agent, no country. The
 * count and the last-used time carry nearly all the information, and a number
 * you can read at a glance beats a table you have to study.
 */
export async function recordOpen(deviceId: string, childId: string): Promise<void> {
  // The first device to open a child's link is the one that was expected, so it
  // is acknowledged on arrival. Warning a parent about the phone they have just
  // handed the link to would train them to ignore the warning.
  const existing = await sql<{ n: number }>`select count(*) as n from link_opens where child_id = ${childId}`;
  const first = Number(existing[0]?.n ?? 0) === 0;

  await sql`
    insert into link_opens (device_id, child_id, acknowledged_at)
    values (${deviceId}, ${childId}, ${first ? new Date().toISOString() : null})
    on conflict (device_id) do update set last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `;
}

/** Devices a parent has not yet confirmed, newest first. Powers the dashboard warning. */
export async function unconfirmedDevices(): Promise<{ child_id: string; n: number; latest: string }[]> {
  return sql<{ child_id: string; n: number; latest: string }>`
    select child_id, count(*) as n, max(first_seen) as latest
    from link_opens where acknowledged_at is null
    group by child_id
  `;
}

/** "That was us" — the device stays, and stops being news. */
export async function confirmDevices(childId: string): Promise<void> {
  await sql`
    update link_opens set acknowledged_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    where child_id = ${childId} and acknowledged_at is null
  `;
}

export async function linkOpens(childId: string): Promise<{ n: number; last: string | null }> {
  const rows = await sql<{ n: number; last: string | null }>`
    select count(*) as n, max(last_seen) as last from link_opens where child_id = ${childId}
  `;
  return { n: Number(rows[0]?.n ?? 0), last: rows[0]?.last ?? null };
}

/** Resets the count, so the next number the parent sees means something again. */
export async function forgetDevices(childId: string): Promise<void> {
  await sql`delete from link_opens where child_id = ${childId}`;
}

export async function setDone(eventId: string, childId: string, done: boolean): Promise<void> {
  await sql`
    update events set done_at = ${done ? new Date().toISOString() : null}
    where id = ${eventId} and child_id = ${childId}
  `;
}

/**
 * How many devices each child has registered for reminders.
 *
 * A row here means a device completed the subscription handshake, and dead
 * endpoints are pruned on the first 404/410, so the count is trustworthy as
 * "has somewhere to send to". It is not proof a notification will be seen —
 * the phone can still be muted, or the app's notifications switched off in
 * system settings, and neither is visible from here.
 */
export async function deviceCounts(): Promise<Record<string, number>> {
  const rows = await sql<{ child_id: string; n: number }>`
    select child_id, count(*) as n from push_subscriptions group by child_id
  `;
  return Object.fromEntries(rows.map((r) => [r.child_id, Number(r.n)]));
}

/**
 * A new link for the same child. Everything else — their events, what they have
 * ticked off, their colour, their registered devices — is keyed to the child's
 * id, not the token, so it all survives.
 */
export async function rotateChildToken(id: string, token: string): Promise<void> {
  await sql`update children set token = ${token} where id = ${id}`;

  /*
   * Rotating only the address left the old devices connected. Push
   * subscriptions are keyed to the child rather than to the token, so a phone
   * whose link had just been revoked carried on receiving every reminder — the
   * one control this app has for a leaked link, quietly doing half its job.
   *
   * Both go. The child re-enables reminders when they add the new link, which
   * is already what the profile tells them to do.
   */
  await sql`delete from push_subscriptions where child_id = ${id}`;
  await sql`delete from link_opens where child_id = ${id}`;
}

export async function renameChild(id: string, name: string): Promise<void> {
  await sql`update children set name = ${name} where id = ${id}`;
}

/** The kid choosing their own emoji and colour. */
export async function setChildLook(id: string, emoji: string, color: string): Promise<void> {
  await sql`update children set emoji = ${emoji}, color = ${color} where id = ${id}`;
}

export async function createChild(
  name: string,
  emoji: string,
  color: string,
  token: string,
  kind: Kind = "child",
  feedToken: string | null = null,
): Promise<void> {
  const rows = await sql<{ n: number }>`select coalesce(max(sort_order), -1) + 1 as n from children`;
  await sql`
    insert into children (id, name, emoji, color, token, kind, feed_token, sort_order)
    values (${newId()}, ${name}, ${emoji}, ${color}, ${token}, ${kind}, ${feedToken}, ${rows[0].n})
  `;
}

/** Resolves a subscribe feed, and records that somebody's calendar fetched it. */
export async function personByFeedToken(feedToken: string): Promise<Child | null> {
  const rows = await sql<Child>`
    select id, name, color, emoji, token, kind, feed_token, last_fetched_at, sort_order from children where feed_token = ${feedToken} limit 1
  `;
  return rows[0] ?? null;
}

export async function touchFetched(id: string): Promise<void> {
  await sql`update children set last_fetched_at = ${new Date().toISOString()} where id = ${id}`;
}

/**
 * What goes into someone's subscribed calendar.
 *
 * A participant sees the activities they are on. An observer sees the whole
 * household — and because a multi-member activity is stored as one row per
 * member, the group has to be collapsed or they would see it several times.
 */
export async function feedEvents(person: Child, start: Date, end: Date): Promise<CalEvent[]> {
  const rows =
    person.kind === "observer"
      ? await allEventsInRange(start, end)
      : await eventsInRange(person.id, start, end);
  if (person.kind !== "observer") return rows;

  const seen = new Set<string>();
  return rows.filter((e) => {
    if (!e.group_id) return true;
    if (seen.has(e.group_id)) return false;
    seen.add(e.group_id);
    return true;
  });
}

/** Both links change together, so one rotation revokes everything. */
export async function rotateFeedToken(id: string, feedToken: string): Promise<void> {
  await sql`update children set feed_token = ${feedToken} where id = ${id}`;
}

/** Explicit rather than relying on cascade, which SQLite only enforces with the pragma on. */
export async function deleteChild(id: string): Promise<void> {
  await sql`delete from events where child_id = ${id}`;
  await sql`delete from push_subscriptions where child_id = ${id}`;
  await sql`delete from link_opens where child_id = ${id}`;
  await sql`delete from children where id = ${id}`;
}

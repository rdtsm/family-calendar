import { newId, raw, sql, type CalEvent, type Child, type CreatedBy, type Kind } from "./db";
import { occurrencesOn } from "./recurrence";
import { dayKeyOf, fmtTime } from "./time";

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
  const rows = await sql<{ group_id: string | null; starts_at: string }>`
    select group_id, starts_at from events where id = ${id}
  `;
  const row = rows[0];
  if (!row) return;
  // group_id names the activity, not the occurrence — a shared weekly repeat
  // carries one group id across all fifty-two weeks. Matching on it alone
  // deleted every week for everyone when the parent asked for one occurrence.
  // The start instant is what narrows it back to this week; the members of one
  // occurrence share it exactly.
  if (row.group_id) {
    await sql`delete from events where group_id = ${row.group_id} and starts_at = ${row.starts_at}`;
  } else {
    await sql`delete from events where id = ${id}`;
  }
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
  const found = await sql<{ id: string; group_id: string | null; starts_at: string }>`
    select id, group_id, starts_at from events where id = ${id} and created_by = 'parent'
  `;
  if (!found.length) return [];

  // group_id and the start instant together, for the reason deleteEvent gives:
  // a shared weekly repeat wears one group id for all of its weeks.
  const group = found[0].group_id;
  const ids = group
    ? (
        await sql<{ id: string }>`
          select id from events
          where group_id = ${group} and starts_at = ${found[0].starts_at} and created_by = 'parent'
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

export type SeriesPatch = {
  title: string;
  emoji: string;
  location: string | null;
  /** Wall clock in the family timezone, the form's own values. */
  startTime: string;
  endTime: string;
};

/**
 * Corrects a repeat: the pattern itself, and every occurrence still to come
 * that follows it.
 *
 * **A week corrected on its own is left alone.** An occurrence whose title,
 * place or wall-clock time no longer matches its series row is by definition
 * one somebody changed deliberately, and overwriting it would undo that with
 * nothing on screen to say so. Deriving that from the series row is what makes
 * it free — the pattern is already stored, and every occurrence is created
 * from it, so divergence *is* the record of a correction. No extra column.
 *
 * The day is never moved. Rewriting which weekday a repeat falls on would
 * collide with the unique (series_id, starts_at) index halfway through, and
 * would have to recompute `materialised_through` or leave the scheduler topping
 * up the wrong runway. Deleting the repeat and adding it again already does it.
 *
 * Forward-looking, like every other write here: what already happened stays.
 * Returns the occurrences whose start actually moved, which is what the
 * reminder ledger has to be told about.
 */
export async function updateSeriesGroup(
  seriesId: string,
  p: SeriesPatch,
  from: Date,
): Promise<{ moved: { id: string; startsAt: string }[] }> {
  const head = await sql<{
    group_id: string | null;
    title: string;
    location: string | null;
    start_time: string;
    end_time: string;
  }>`select group_id, title, location, start_time, end_time from series where id = ${seriesId}`;
  const pattern = head[0];
  if (!pattern) return { moved: [] };

  // One series per member of a shared repeat, exactly as endSeriesGroup walks it.
  const group = pattern.group_id;
  const seriesIds = group
    ? (await sql<{ id: string }>`select id from series where group_id = ${group}`).map((r) => r.id)
    : [seriesId];

  /*
   * One member's occurrences supply the instants; the write then lands on
   * everyone who is there at that instant. Walking each member's own series
   * instead would miss anybody added to a single week — a guest has no series
   * of their own — and strand them at the old time under the same group id,
   * two times on one day with the agenda showing only the first.
   */
  const occurrences = await sql<{
    id: string;
    title: string;
    location: string | null;
    starts_at: string;
    ends_at: string;
  }>`
    select id, title, location, starts_at, ends_at
    from events
    where series_id = ${seriesId} and created_by = 'parent' and starts_at >= ${from.toISOString()}
    order by starts_at
  `;

  // Every member's row, indexed by instant, so the ids that moved are known
  // without a query per week.
  const byInstant = new Map<string, string[]>();
  if (group) {
    const rows = await sql<{ id: string; starts_at: string }>`
      select id, starts_at from events
      where group_id = ${group} and created_by = 'parent' and starts_at >= ${from.toISOString()}
    `;
    for (const r of rows) byInstant.set(r.starts_at, [...(byInstant.get(r.starts_at) ?? []), r.id]);
  }

  const moved: { id: string; startsAt: string }[] = [];

  for (const e of occurrences) {
    const follows =
      e.title === pattern.title &&
      (e.location ?? null) === (pattern.location ?? null) &&
      // Wall clock, not the instant: an occurrence keeps its local time across
      // a daylight-saving change, so this is the comparison that holds.
      fmtTime(e.starts_at) === pattern.start_time &&
      fmtTime(e.ends_at) === pattern.end_time;
    if (!follows) continue;

    const [when] = occurrencesOn([dayKeyOf(e.starts_at)], p.startTime, p.endTime);
    const startsAt = when.startsAt.toISOString();
    const touched = byInstant.get(e.starts_at) ?? [e.id];

    if (group) {
      await sql`
        update events
        set title = ${p.title}, emoji = ${p.emoji}, location = ${p.location},
            starts_at = ${startsAt}, ends_at = ${when.endsAt.toISOString()}
        where group_id = ${group} and starts_at = ${e.starts_at} and created_by = 'parent'
      `;
    } else {
      await sql`
        update events
        set title = ${p.title}, emoji = ${p.emoji}, location = ${p.location},
            starts_at = ${startsAt}, ends_at = ${when.endsAt.toISOString()}
        where id = ${e.id}
      `;
    }

    if (when.startsAt.getTime() !== new Date(e.starts_at).getTime()) {
      for (const id of touched) {
        await sql`update events set done_at = null where id = ${id}`;
        moved.push({ id, startsAt });
      }
    }
  }

  // The patterns last, so the comparison above is made against what the
  // occurrences were actually created from.
  for (const id of seriesIds) {
    await sql`
      update series
      set title = ${p.title}, emoji = ${p.emoji}, location = ${p.location},
          start_time = ${p.startTime}, end_time = ${p.endTime}
      where id = ${id}
    `;
  }

  return { moved };
}

/**
 * Who is on an activity — this occurrence, or every one still to come.
 *
 * Membership is read at the occurrence that was tapped, which is exactly what
 * the pills showed, and written only where the caller asks. Forward-looking
 * like every other write here: past weeks keep whoever was on them.
 *
 * Adding somebody for one week of a repeat leaves them without a series of
 * their own, which is deliberate — they came on a Tuesday, they did not join
 * the repeat. `updateSeriesGroup` and `endSeriesGroup` both follow the group
 * rather than the series so that guest is neither stranded nor orphaned.
 */
export async function setMembers(
  eventId: string,
  wanted: string[],
  scope: "one" | "series",
  from: Date,
): Promise<{ added: string[] }> {
  const found = await sql<CalEvent>`
    select id, child_id, title, emoji, location, starts_at, ends_at, series_id, group_id, created_by, done_at
    from events where id = ${eventId} and created_by = 'parent'
  `;
  const ref = found[0];
  if (!ref) return { added: [] };
  // A guest's row has no series to spread across.
  const wide = scope === "series" && !!ref.series_id;

  /*
   * group_id names the activity, not the occurrence, so minting one stamps
   * every week — see lib/schema.sql. Stamping only the week being edited would
   * leave the invariant half true, which is the shape of the bug that made
   * "delete this event" remove a whole term.
   */
  let group = ref.group_id;
  if (!group) {
    /*
     * The first member's own event id, rather than a fresh one. The agenda keys
     * a collapsed row on `group_id ?? id`, so minting anything else would change
     * that key the moment a second person joined — React would remount the row,
     * and the edit panel inside it would lose the result of the save that had
     * just succeeded and sit there looking like it had failed.
     */
    group = ref.id;
    if (ref.series_id) {
      await sql`update events set group_id = ${group} where series_id = ${ref.series_id}`;
      await sql`update series set group_id = ${group} where id = ${ref.series_id}`;
    } else {
      await sql`update events set group_id = ${group} where id = ${ref.id}`;
    }
  }

  const current = (
    await sql<{ child_id: string }>`
      select child_id from events
      where group_id = ${group} and starts_at = ${ref.starts_at} and created_by = 'parent'
    `
  ).map((r) => r.child_id);

  const add = wanted.filter((id) => !current.includes(id));
  const drop = current.filter((id) => !wanted.includes(id));
  if (!add.length && !drop.length) return { added: [] };

  const since = from.toISOString();

  for (const childId of drop) {
    if (wide) {
      await sql`
        delete from events
        where group_id = ${group} and child_id = ${childId} and starts_at >= ${since}
      `;
      // Their series stops generating; everyone else's carries on.
      await sql`update series set active = 0 where group_id = ${group} and child_id = ${childId}`;
    } else {
      await sql`
        delete from events
        where group_id = ${group} and child_id = ${childId} and starts_at = ${ref.starts_at}
      `;
    }
  }

  if (!add.length) return { added: [] };

  /*
   * The occurrences are mirrored from the member already on them rather than
   * regenerated from the pattern, so a week corrected on its own is joined at
   * the time it actually has instead of the time the pattern says.
   */
  const occurrences = wide
    ? await sql<{ title: string; emoji: string; location: string | null; starts_at: string; ends_at: string }>`
        select title, emoji, location, starts_at, ends_at from events
        where series_id = ${ref.series_id} and created_by = 'parent' and starts_at >= ${since}
        order by starts_at
      `
    : [{ title: ref.title, emoji: ref.emoji, location: ref.location, starts_at: ref.starts_at, ends_at: ref.ends_at }];
  if (!occurrences.length) return { added: [] };

  const runway = wide
    ? (
        await sql<{ materialised_through: string }>`
          select materialised_through from series where id = ${ref.series_id}
        `
      )[0]?.materialised_through
    : null;

  const rows: NewEvent[] = [];
  for (const childId of add) {
    // Somebody who guested on a few weeks keeps those rows; only the weeks they
    // are missing from are filled in, or the insert would double them up.
    const already = new Set(
      (
        await sql<{ starts_at: string }>`
          select starts_at from events
          where group_id = ${group} and child_id = ${childId} and starts_at >= ${since}
        `
      ).map((r) => r.starts_at),
    );

    const seriesId =
      wide && runway
        ? await createSeries({
            child_id: childId,
            group_id: group,
            title: ref.title,
            emoji: ref.emoji,
            location: ref.location,
            start_time: fmtTime(ref.starts_at),
            end_time: fmtTime(ref.ends_at),
            materialised_through: runway,
          })
        : null;

    for (const o of occurrences) {
      if (already.has(o.starts_at)) continue;
      rows.push({
        childId,
        groupId: group,
        title: o.title,
        emoji: o.emoji,
        location: o.location,
        startsAt: new Date(o.starts_at),
        endsAt: new Date(o.ends_at),
        seriesId,
      });
    }
  }

  return { added: rows.length ? await insertEvents(rows) : [] };
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

  // Anyone added to a single week has no series to end, so ending them all
  // would leave that person holding an activity nobody else is at.
  if (group) {
    await sql`delete from events where group_id = ${group} and starts_at >= ${from.toISOString()}`;
  }
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

  /*
   * Keyed on the group *and the instant*, because group_id names the activity
   * rather than the occurrence: a shared weekly repeat wears one group id across
   * all fifty-two weeks. Deduping on it alone collapsed the whole term into a
   * single entry in an observer's calendar — the same mistake that once let
   * "delete this event" remove every week.
   */
  const seen = new Set<string>();
  return rows.filter((e) => {
    if (!e.group_id) return true;
    const key = `${e.group_id}|${e.starts_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
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

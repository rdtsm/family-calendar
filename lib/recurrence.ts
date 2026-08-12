import { shiftDay, wallToInstant, type DayKey } from "./time";

export type Occurrence = { startsAt: Date; endsAt: Date };

/** 52 weeks of runway, so nothing lapses even if the scheduler stops for months. */
export const HORIZON_WEEKS = 52;

/** Every seventh day from `first` up to and including `through`. Empty if first > through. */
export function weeklyDays(first: DayKey, through: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let d = first; d <= through; d = shiftDay(d, 7)) out.push(d);
  return out;
}

/**
 * Wall-clock times are converted per occurrence rather than by adding seven
 * days to an instant, so a series stays at 15:00 local across a daylight-saving
 * change. A zone without daylight saving never exercises this; most do.
 */
export function occurrencesOn(days: DayKey[], start: string, end: string): Occurrence[] {
  return days.map((d) => {
    const startsAt = wallToInstant(d, start);
    let endsAt = wallToInstant(d, end);
    // An end at or before the start means it runs past midnight.
    if (endsAt <= startsAt) endsAt = wallToInstant(shiftDay(d, 1), end);
    return { startsAt, endsAt };
  });
}

/**
 * The furthest date any series is materialised to. Creation and the scheduler
 * share this one definition, so a freshly created series is already at the
 * horizon and the next top-up correctly finds nothing to do.
 */
export function horizonDay(today: DayKey): DayKey {
  return shiftDay(today, (HORIZON_WEEKS - 1) * 7);
}

/** A one-off, or a repeat filled out to the horizon. */
export function expand(
  day: DayKey,
  start: string,
  end: string,
  weekly: boolean,
  today: DayKey,
): Occurrence[] {
  const days = weekly ? weeklyDays(day, horizonDay(today)) : [day];
  return occurrencesOn(days, start, end);
}

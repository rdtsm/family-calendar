"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PARENT_ACCENT } from "@/lib/colors";
import { dayKeyOf, fmtTime, fmtWeekdayLong, type DayKey } from "@/lib/time";
import { editEventAction } from "./actions";
import type { Child } from "@/lib/db";
import { Field, TitleField, WhenFields, WhoField } from "./fields";

/* One save button or two, they are the same button. 15px because two of them
   side by side have to hold their words at 360px. */
const SAVE =
  "rounded-2xl px-2 py-3.5 text-[15px] font-bold text-on-accent transition active:scale-[0.98] disabled:opacity-60";
const ACCENT = { background: PARENT_ACCENT };

/**
 * Correcting an activity, in the row it already occupies.
 *
 * It opens where it was tapped rather than at the form at the top of the page:
 * the thing being corrected stays in view, and a list a screen long does not
 * throw you to the top to change one number.
 *
 * A repeat offers the same two scopes deletion does, and they govern who is on
 * it as well as when it is — see `editEventAction`.
 */
export default function EditEvent({
  event,
  people,
  members,
  today,
  onDone,
}: {
  event: { id: string; title: string; location: string | null; startsAt: string; endsAt: string; seriesId: string | null };
  /** Everyone who can be on an activity, in the same order the create form lists them. */
  people: Child[];
  /** Who is on this occurrence, which is what the pills open showing. */
  members: string[];
  today: DayKey;
  onDone: () => void;
}) {
  /*
   * The result is handled in the submit closure rather than through
   * useActionState, because moving an activity to another day moves its row
   * into a different day's list — React unmounts it, and any state holding the
   * outcome goes with it. The panel then sat open on a save that had already
   * succeeded. `onDone` belongs to the agenda, so it survives.
   */
  const [error, setError] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();
  const originalDay = dayKeyOf(event.startsAt);
  const [picked, setPicked] = useState<string[]>(members);
  const [title, setTitle] = useState(event.title);
  const [day, setDay] = useState<DayKey>(originalDay);
  const [start, setStart] = useState(fmtTime(event.startsAt));
  const [end, setEnd] = useState(fmtTime(event.endsAt));
  const [location, setLocation] = useState(event.location ?? "");
  const scope = useRef<HTMLInputElement>(null);
  const setScope = (v: string) => {
    if (scope.current) scope.current.value = v;
  };

  const whoChanged =
    picked.length !== members.length || picked.some((id) => !members.includes(id));

  /*
   * Escape closes it; tapping elsewhere does not. The delete confirmation
   * dismisses on any tap away because it holds nothing — this holds what has
   * been typed, and the native date and time pickers draw outside the page, so
   * a tap on one can read as a tap on nothing. Losing an edit to that is worse
   * than the extra tap on Cancel.
   */
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onDone]);

  return (
    <form
      action={(data) =>
        startSaving(async () => {
          const result = await editEventAction({}, data);
          // The saved row is already on screen behind the panel, so there is
          // nothing left to read on success.
          if (result.ok) onDone();
          else setError(result.error ?? null);
        })
      }
      aria-label="Edit activity"
      className="space-y-4"
    >
      <input type="hidden" name="id" value={event.id} />
      <input type="hidden" name="day" value={day} />
      {/* Uncontrolled on purpose. The scope cannot ride on the submit button's
          own name and value — those do not reach a server action's FormData —
          and it cannot be React state either, because the click that sets the
          state is the same click that submits. A ref written in the handler is
          read by the submit that follows it, and `defaultValue` is what stops
          React putting it back. */}
      <input ref={scope} type="hidden" name="scope" defaultValue="one" />

      {/* Written only when the pills were touched. Otherwise correcting a time
          from a week somebody guested on would silently drop them everywhere,
          because the panel would be applying a membership nobody chose. */}
      <input type="hidden" name="whoChanged" value={whoChanged ? "1" : "0"} />

      {event.seriesId && (
        <p className="text-[15px] text-fg-2">every {fmtWeekdayLong(originalDay)}</p>
      )}

      <Field label="Who">
        <WhoField people={people} picked={picked} setPicked={setPicked} />
      </Field>

      <Field label="What">
        <TitleField title={title} setTitle={setTitle} />
      </Field>

      <Field label="When">
        <WhenFields
          day={day}
          setDay={setDay}
          start={start}
          setStart={setStart}
          end={end}
          setEnd={setEnd}
          today={today}
        />
      </Field>

      <Field label="Where (optional)">
        <input
          name="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Club, school hall…"
          autoComplete="off"
          className="w-full rounded-2xl bg-raised px-4 py-3.5 text-[17px] outline-none placeholder:text-fg-3"
        />
      </Field>

      {event.seriesId ? (
        <div className="space-y-2">
          {/* The same two scopes, in the same order and the same words as the
              delete confirmation. A repeat is one decision the screen has
              already taught once. */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setScope("one")} disabled={pending || !picked.length} className={SAVE} style={ACCENT}>
              Save this week
            </button>
            <button
              onClick={() => setScope("series")}
              disabled={pending || !picked.length || day !== originalDay}
              className={SAVE}
              style={ACCENT}
            >
              Save all weeks
            </button>
          </div>
          <p className="text-[13px] text-fg-3">
            {day !== originalDay
              ? "A different day applies to this week only. To move every week, delete the repeat and add it again."
              : "All weeks keeps the day and changes the rest. A week you corrected on its own keeps what you gave it."}
          </p>
        </div>
      ) : (
        <button disabled={pending || !picked.length} className={`${SAVE} w-full`} style={ACCENT}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      )}

      <button
        type="button"
        onClick={onDone}
        className="w-full rounded-2xl bg-raised py-3.5 text-[17px] font-semibold text-fg-2 transition active:scale-[0.98]"
      >
        Cancel
      </button>

      {error && (
        <p role="alert" className="text-center text-[15px] font-semibold text-kid-rose-ink">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { PARENT_ACCENT } from "@/lib/colors";
import { dayKeyOf, fmtTime, fmtWeekdayLong, type DayKey } from "@/lib/time";
import { editEventAction, type FormState } from "./actions";
import { Field, TitleField, WhenFields } from "./fields";

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
 * A repeat offers the same two scopes deletion does. Who is stated, not
 * offered — see `editEventAction`.
 */
export default function EditEvent({
  event,
  who,
  today,
  onDone,
}: {
  event: { id: string; title: string; location: string | null; startsAt: string; endsAt: string; seriesId: string | null };
  who: string;
  today: DayKey;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(editEventAction, {});
  const originalDay = dayKeyOf(event.startsAt);
  const [title, setTitle] = useState(event.title);
  const [day, setDay] = useState<DayKey>(originalDay);
  const [start, setStart] = useState(fmtTime(event.startsAt));
  const [end, setEnd] = useState(fmtTime(event.endsAt));
  const [location, setLocation] = useState(event.location ?? "");
  const scope = useRef<HTMLInputElement>(null);
  const setScope = (v: string) => {
    if (scope.current) scope.current.value = v;
  };

  // The saved row is already on screen behind the panel, so there is nothing
  // left to read here.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

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
    <form action={action} aria-label="Edit activity" className="space-y-4">
      <input type="hidden" name="id" value={event.id} />
      <input type="hidden" name="day" value={day} />
      {/* Uncontrolled on purpose. The scope cannot ride on the submit button's
          own name and value — those do not reach a server action's FormData —
          and it cannot be React state either, because the click that sets the
          state is the same click that submits. A ref written in the handler is
          read by the submit that follows it, and `defaultValue` is what stops
          React putting it back. */}
      <input ref={scope} type="hidden" name="scope" defaultValue="one" />

      <p className="text-[15px] text-fg-2">
        {who}
        {event.seriesId && ` · every ${fmtWeekdayLong(originalDay)}`}
      </p>

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
            <button onClick={() => setScope("one")} disabled={pending} className={SAVE} style={ACCENT}>
              Save this week
            </button>
            <button
              onClick={() => setScope("series")}
              disabled={pending || day !== originalDay}
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
        <button disabled={pending} className={`${SAVE} w-full`} style={ACCENT}>
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

      {state.error && (
        <p role="alert" className="text-center text-[15px] font-semibold text-kid-rose-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}

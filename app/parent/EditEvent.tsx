"use client";

import { useActionState, useEffect, useState } from "react";
import { PARENT_ACCENT } from "@/lib/colors";
import { dayKeyOf, fmtTime, type DayKey } from "@/lib/time";
import { editEventAction, type FormState } from "./actions";
import { Field, TitleField, WhenFields } from "./fields";

/**
 * Correcting an activity, in the row it already occupies.
 *
 * It opens where it was tapped rather than at the form at the top of the page:
 * the thing being corrected stays in view, and a list a screen long does not
 * throw you to the top to change one number.
 *
 * Who and the repeat are stated, not offered — see `editEventAction`.
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
  const [title, setTitle] = useState(event.title);
  const [day, setDay] = useState<DayKey>(dayKeyOf(event.startsAt));
  const [start, setStart] = useState(fmtTime(event.startsAt));
  const [end, setEnd] = useState(fmtTime(event.endsAt));
  const [location, setLocation] = useState(event.location ?? "");

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

      <p className="text-[15px] text-fg-2">
        {who}
        {event.seriesId && " · part of a weekly repeat — this changes only this week"}
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

      <div className="flex gap-2">
        <button
          disabled={pending}
          className="flex-1 rounded-2xl py-3.5 text-[17px] font-bold text-on-accent transition active:scale-[0.98] disabled:opacity-60"
          style={{ background: PARENT_ACCENT }}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-2xl bg-raised px-5 py-3.5 text-[17px] font-semibold text-fg-2 transition active:scale-[0.98]"
        >
          Cancel
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-center text-[15px] font-semibold text-kid-rose-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import { emojiFor } from "@/lib/emoji";
import { shiftDay, type DayKey } from "@/lib/time";

/**
 * The pieces both parent forms are built from.
 *
 * Adding and correcting are the same act seen twice, so they are the same
 * controls — shared here rather than copied, which is what stops one of them
 * being tuned and the other quietly left behind.
 */

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[15px] font-semibold text-fg-2">{label}</div>
      {children}
    </div>
  );
}

/** The title, with the emoji the title itself implies shown beside it. */
export function TitleField({
  title,
  setTitle,
  inputRef,
}: {
  title: string;
  setTitle: (v: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-raised px-4">
      <span className="text-xl" aria-hidden>
        {title ? emojiFor(title) : "📌"}
      </span>
      <input
        ref={inputRef}
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Type it, or tap below"
        aria-label="Activity"
        autoComplete="off"
        className="w-full bg-transparent py-3.5 text-[17px] outline-none placeholder:text-fg-3"
      />
    </div>
  );
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Three captioned fields of one shape. The caption is what tells a start from
 * an end; before there was none, and two identical pills side by side read as a
 * single control with a stray second number in it.
 *
 * The pill carries the full width, the input inside it only its own value. That
 * puts each browser's picker chevron immediately after the value instead of
 * stranding it at the far edge of a wide field, and it makes the earlier bug
 * impossible: whether the input stretches or sits at its intrinsic width no
 * longer changes what is on screen.
 *
 * `followStart` moves the end along with the start until the end is touched.
 * Right when entering something new, wrong when correcting it — an existing
 * two-hour activity would silently become one.
 */
export function WhenFields({
  day,
  setDay,
  start,
  setStart,
  end,
  setEnd,
  today,
  followStart = false,
}: {
  day: DayKey;
  setDay: (v: DayKey) => void;
  start: string;
  setStart: (v: string) => void;
  end: string;
  setEnd: (v: string) => void;
  today: DayKey;
  followStart?: boolean;
}) {
  const [endTouched, setEndTouched] = useState(false);

  return (
    <>
      <div className="space-y-2">
        {/* One column of the same two-column grid the times use, so the three
            fields are one module wide. A field should be as wide as the value
            it expects: a date is ten fixed characters, and giving it the full
            card left it two-thirds empty. What and Where stay full width
            because free text has no length to size to. */}
        <div className="grid grid-cols-2 gap-2">
          <label className="block rounded-2xl bg-raised px-4 py-2">
            <span className="block text-[13px] font-semibold text-fg-3">Date</span>
            <input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              aria-label="Date"
              className="max-w-full bg-transparent text-[17px] outline-none"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block rounded-2xl bg-raised px-4 py-2">
            <span className="block text-[13px] font-semibold text-fg-3">Start</span>
            <input
              type="time"
              name="start"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (followStart && !endTouched && e.target.value) setEnd(addHour(e.target.value));
              }}
              aria-label="Start time"
              className="max-w-full bg-transparent text-[17px] outline-none"
            />
          </label>
          <label className="block rounded-2xl bg-raised px-4 py-2">
            <span className="block text-[13px] font-semibold text-fg-3">End</span>
            <input
              type="time"
              name="end"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setEndTouched(true);
              }}
              aria-label="End time"
              className="max-w-full bg-transparent text-[17px] outline-none"
            />
          </label>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        {[0, 1, 2].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setDay(shiftDay(today, n))}
            className={`rounded-full px-3 py-1.5 text-[15px] font-semibold transition ${
              day === shiftDay(today, n) ? "bg-fg text-surface" : "bg-raised text-fg-2"
            }`}
          >
            {n === 0 ? "Today" : n === 1 ? "Tomorrow" : "In 2 days"}
          </button>
        ))}
      </div>
    </>
  );
}

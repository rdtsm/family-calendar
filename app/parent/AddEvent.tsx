"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Child } from "@/lib/db";
import { accent, PARENT_ACCENT } from "@/lib/colors";
import { emojiFor, QUICK_PICKS } from "@/lib/emoji";
import { fmtDayLabel, fmtWeekdayLong, shiftDay, type DayKey } from "@/lib/time";
import { addEventAction, type FormState } from "./actions";

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function AddEvent({ children, today }: { children: Child[]; today: DayKey }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addEventAction, {});
  // Several people can be on one activity — the school run is one event with a
  // kid and the adult driving, not two.
  const [picked, setPicked] = useState<string[]>(children[0] ? [children[0].id] : []);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<DayKey>(today);
  const [start, setStart] = useState("15:00");
  const [end, setEnd] = useState("16:00");
  const [endTouched, setEndTouched] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [location, setLocation] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  // Clear the form after a successful save so the next entry starts fresh.
  useEffect(() => {
    if (state.ok) {
      setTitle("");
      setLocation("");
      setWeekly(false);
      titleRef.current?.focus();
    }
  }, [state.ok]);

  const chosen = children.filter((c) => picked.includes(c.id));
  const who = chosen.length ? chosen.map((c) => c.name).join(" & ") : "—";
  const a = PARENT_ACCENT;

  return (
    <section className="rounded-3xl bg-card p-4" style={{ ["--accent" as string]: a }}>
      <h2 className="text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">New activity</h2>

      <form action={action} className="mt-4 space-y-5">
        {picked.map((id) => (
          <input key={id} type="hidden" name="childId" value={id} />
        ))}
        <input type="hidden" name="day" value={day} />
        <input type="hidden" name="weekly" value={weekly ? "1" : "0"} />

        <Field label="Who">
          {/* Tight on purpose. Measured at 360px — the commonest Android width —
              this is what fits five people on two rows instead of three;
              reclaiming card padding alone does not. Vertical padding is
              untouched, so the target stays about 44px tall. */}
          <div role="group" aria-label="Who" className="flex flex-wrap gap-1.5">
            {children.map((c) => {
              const on = picked.includes(c.id);
              const ca = accent(c.color);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
                  }
                  aria-pressed={on}
                  className={`flex items-center gap-1.5 rounded-2xl px-3 py-2.5 text-[17px] font-semibold transition ${
                    on ? "text-on-accent" : "bg-raised text-fg-2"
                  }`}
                  style={on ? { background: ca, color: "oklch(0.20 0.012 280)" } : undefined}
                >
                  <span aria-hidden>{c.emoji}</span>
                  {c.name}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="What">
          <div className="flex items-center gap-3 rounded-2xl bg-raised px-4">
            <span className="text-xl" aria-hidden>
              {title ? emojiFor(title) : "📌"}
            </span>
            <input
              ref={titleRef}
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Type it, or tap below"
              aria-label="Activity"
              autoComplete="off"
              className="w-full bg-transparent py-3.5 text-[17px] outline-none placeholder:text-fg-3"
            />
          </div>
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
            {QUICK_PICKS.map((q) => (
              <button
                key={q.title}
                type="button"
                onClick={() => setTitle(q.title)}
                className="shrink-0 rounded-full bg-raised px-3 py-1.5 text-[15px] font-semibold text-fg-2 transition active:scale-95"
              >
                <span aria-hidden>{q.emoji}</span> {q.title}
              </button>
            ))}
          </div>
        </Field>

        <Field label="When">
          {/*
           * Three captioned fields of one shape. The caption is what tells a
           * start from an end; before there was none, and two identical pills
           * side by side read as a single control with a stray second number in
           * it.
           *
           * The pill carries the full width, the input inside it only its own
           * value. That puts each browser's picker chevron immediately after
           * the value instead of stranding it at the far edge of a wide field,
           * and it makes the earlier bug impossible: whether the input stretches
           * or sits at its intrinsic width no longer changes what is on screen.
           */}
          <div className="space-y-2">
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
            <div className="grid grid-cols-2 gap-2">
              <label className="block rounded-2xl bg-raised px-4 py-2">
                <span className="block text-[13px] font-semibold text-fg-3">Start</span>
                <input
                  type="time"
                  name="start"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (!endTouched && e.target.value) setEnd(addHour(e.target.value));
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
        </Field>

        <Field label="Repeat">
          <div className="flex gap-2">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setWeekly(v)}
                aria-pressed={v === weekly}
                className={`flex-1 rounded-2xl px-3 py-3 text-[17px] font-semibold transition ${
                  v === weekly ? "text-on-accent" : "bg-raised text-fg-2"
                }`}
                style={v === weekly ? { background: a, color: "oklch(0.20 0.012 280)" } : undefined}
              >
                {v ? "Every week" : "Once"}
              </button>
            ))}
          </div>
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

        <div>
          <button
            disabled={pending || !picked.length}
            className="w-full rounded-2xl py-4 text-[17px] font-bold text-on-accent transition active:scale-[0.98] disabled:opacity-60"
            style={{ background: a }}
          >
            {pending ? "Saving…" : weekly ? "Add every week" : "Add to calendar"}
          </button>
          <p className="mt-2 text-center text-[15px] text-fg-2">
            {weekly
              ? `${who} · every ${fmtWeekdayLong(day)} from ${fmtDayLabel(day, today)} · ${start}–${end}`
              : `${who} · ${fmtDayLabel(day, today)} · ${start}–${end}`}
          </p>
          {state.error && (
            <p role="alert" className="mt-2 text-center text-[15px] font-semibold text-kid-rose-ink">
              {state.error}
            </p>
          )}
          {state.ok && (
            <p role="status" className="mt-2 text-center text-[15px] font-semibold text-kid-mint-ink">
              {state.ok}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[15px] font-semibold text-fg-2">{label}</div>
      {children}
    </div>
  );
}

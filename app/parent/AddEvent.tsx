"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Child } from "@/lib/db";
import { PARENT_ACCENT } from "@/lib/colors";
import { QUICK_PICKS } from "@/lib/emoji";
import { fmtDayLabel, fmtWeekdayLong, type DayKey } from "@/lib/time";
import { addEventAction, type FormState } from "./actions";
import { Field, TitleField, WhenFields, WhoField } from "./fields";

export default function AddEvent({ children, today }: { children: Child[]; today: DayKey }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addEventAction, {});
  // Several people can be on one activity — the school run is one event with a
  // kid and the adult driving, not two.
  const [picked, setPicked] = useState<string[]>(children[0] ? [children[0].id] : []);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<DayKey>(today);
  const [start, setStart] = useState("15:00");
  const [end, setEnd] = useState("16:00");
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
        <input type="hidden" name="day" value={day} />
        <input type="hidden" name="weekly" value={weekly ? "1" : "0"} />

        <Field label="Who">
          <WhoField people={children} picked={picked} setPicked={setPicked} />
        </Field>

        <Field label="What">
          <TitleField title={title} setTitle={setTitle} inputRef={titleRef} />
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
          <WhenFields
            day={day}
            setDay={setDay}
            start={start}
            setStart={setStart}
            end={end}
            setEnd={setEnd}
            today={today}
            followStart
          />
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

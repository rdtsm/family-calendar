"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Child } from "@/lib/db";
import { accent } from "@/lib/colors";
import { dayKeyOf, fmtDayLabel, fmtTime, shiftDay, type DayKey } from "@/lib/time";

/** How much further ahead each "Show more" reaches. */
const WEEKS_STEP = 5;
import { deleteEventAction } from "./actions";
import EditEvent from "./EditEvent";

type Row = {
  id: string;
  childId: string;
  title: string;
  emoji: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  seriesId: string | null;
  groupId: string | null;
  doneAt: string | null;
};

export default function Agenda({ children, events, today }: { children: Child[]; events: Row[]; today: DayKey }) {
  const [filter, setFilter] = useState<string>("all");
  // One at a time: tapping another row moves the panel rather than opening a second.
  const [editing, setEditing] = useState<string | null>(null);
  // A year is loaded, but rendering a year of weekly repeats at once is several
  // hundred rows on a phone. Revealed a chunk at a time, from data already here.
  const [weeks, setWeeks] = useState(WEEKS_STEP);
  const stopEditing = useCallback(() => setEditing(null), []);
  const byId = useMemo(() => new Map(children.map((c) => [c.id, c])), [children]);

  const horizon = useMemo(() => shiftDay(today, weeks * 7), [today, weeks]);
  const inWindow = useMemo(() => events.filter((e) => dayKeyOf(e.startsAt) <= horizon), [events, horizon]);
  const more = inWindow.length < events.length;

  const visible = filter === "all" ? inWindow : inWindow.filter((e) => e.childId === filter);

  /**
   * One activity with several members is stored as one row per member. Here
   * they collapse back into a single line listing everyone, so the day reads as
   * what is happening rather than as the same thing repeated.
   */
  const grouped = useMemo(() => {
    const m = new Map<DayKey, Row[][]>();
    for (const e of visible) {
      const k = dayKeyOf(e.startsAt);
      if (!m.has(k)) m.set(k, []);
      const day = m.get(k)!;
      const mate = e.groupId ? day.find((g) => g[0].groupId === e.groupId) : undefined;
      if (mate) mate.push(e);
      else day.push([e]);
    }
    return [...m.entries()];
  }, [visible]);

  return (
    <section className="mt-8" aria-label="Coming up">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">Coming up</h2>
        {children.length > 1 && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            <FilterChip on={filter === "all"} onClick={() => setFilter("all")} label="All" />
            {children.map((c) => (
              <FilterChip key={c.id} on={filter === c.id} onClick={() => setFilter(c.id)} label={c.name} color={accent(c.color)} />
            ))}
          </div>
        )}
      </div>

      {grouped.length === 0 ? (
        <p className="rounded-3xl bg-card p-6 text-center text-[17px] text-fg-2">
          Nothing scheduled yet.
        </p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, rows]) => (
            <div key={day}>
              <h3 className="mb-2 text-[17px] font-bold">{fmtDayLabel(day, today)}</h3>
              <ol className="space-y-1.5">
                {rows.map((members) => {
                  const e = members[0];
                  const names = members.map((m) => byId.get(m.childId)?.name).filter(Boolean);
                  const a = accent(byId.get(e.childId)?.color ?? "violet");
                  const done = members.every((m) => m.doneAt);
                  return (
                    <li
                      key={e.groupId ?? e.id}
                      className="rounded-2xl bg-card p-3"
                      style={{ boxShadow: `inset 3px 0 0 0 ${a}` }}
                    >
                      {editing === e.id ? (
                        <EditEvent
                          event={{
                            id: e.id,
                            title: e.title,
                            location: e.location,
                            startsAt: e.startsAt,
                            endsAt: e.endsAt,
                            seriesId: e.seriesId,
                          }}
                          who={names.join(" & ")}
                          today={today}
                          onDone={stopEditing}
                        />
                      ) : (
                        <div className="flex items-center gap-3">
                          {/* The whole line is the way in. A pencil beside the ×
                              would say so more loudly, and cost the title the
                              width it needs on a 360px phone. */}
                          <button
                            type="button"
                            onClick={() => setEditing(e.id)}
                            aria-label={`Edit ${e.title}`}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <span className="w-24 shrink-0 text-[15px] font-semibold tabular-nums text-fg-2">
                              {fmtTime(e.startsAt)}–{fmtTime(e.endsAt)}
                            </span>
                            <span aria-hidden>{e.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[17px] font-semibold">
                                {e.title}
                                {done && <span className="ml-2 text-[13px] font-bold text-kid-mint-ink">DONE</span>}
                              </div>
                              <div className="truncate text-[15px] text-fg-2">
                                {names.join(" & ")}
                                {e.location ? ` · ${e.location}` : ""}
                              </div>
                            </div>
                          </button>
                          <DeleteButtons id={e.id} seriesId={e.seriesId} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

          {more && (
            <button
              onClick={() => setWeeks((w) => w + WEEKS_STEP)}
              className="w-full rounded-2xl bg-card py-3.5 text-[17px] font-semibold text-fg-2 transition active:scale-[0.99]"
            >
              Show more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FilterChip({ on, onClick, label, color }: { on: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[15px] font-semibold transition ${on ? "text-on-accent" : "bg-card text-fg-2"}`}
      style={on ? { background: color ?? "white", color: "oklch(0.20 0.012 280)" } : undefined}
    >
      {label}
    </button>
  );
}

function DeleteButtons({ id, seriesId }: { id: string; seriesId: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // A confirmation that can only be dismissed by hitting a small × is a trap on
  // a phone. Tapping anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Delete event"
        className="grid size-9 shrink-0 place-items-center rounded-full text-fg-3 transition hover:text-fg"
      >
        ✕
      </button>
    );
  }

  return (
    <div ref={box} className="flex shrink-0 items-center gap-1.5">
      <form action={deleteEventAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="scope" value="one" />
        <button className="rounded-full bg-kid-rose/25 px-3 py-2 text-[15px] font-bold text-kid-rose-ink">
          {seriesId ? "This event" : "Delete"}
        </button>
      </form>

      {seriesId && (
        <form action={deleteEventAction}>
          <input type="hidden" name="seriesId" value={seriesId} />
          <input type="hidden" name="scope" value="series" />
          <button className="rounded-full bg-kid-rose/25 px-3 py-2 text-[15px] font-bold text-kid-rose-ink">
            All events
          </button>
        </form>
      )}

      <button
        onClick={() => setOpen(false)}
        aria-label="Don’t delete"
        className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2"
      >
        ✕
      </button>
    </div>
  );
}

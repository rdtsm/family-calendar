"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { accent, accentInk, ACCENT_NAMES, AVATARS } from "@/lib/colors";
import {
  dayKeyOf,
  dayOfMonth,
  fmtDayLabel,
  fmtTime,
  fmtWeekday,
  humanCountdown,
  minutesUntil,
  shiftDay,
  type DayKey,
} from "@/lib/time";
import {
  addOwnEventAction,
  deleteOwnEventAction,
  noteDeviceAction,
  toggleDoneAction,
  updateLookAction,
} from "./actions";
import { KID_PICKS } from "@/lib/emoji";
import EnableNotifications from "./EnableNotifications";
import InstallHint from "./InstallHint";
import { ensureWorker } from "./registerWorker";

export type KidEvent = {
  id: string;
  title: string;
  emoji: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  /** The child added this themselves. Renders quieter, and only these can be removed. */
  mine: boolean;
  doneAt: string | null;
};

type Props = {
  child: { id: string; name: string; emoji: string; color: string; token: string };
  events: KidEvent[];
  today: DayKey;
  /** Day to open on — set when arriving from a notification. */
  initialDay: DayKey;
  daysBack: number;
  daysForward: number;
  /** Server time when this document was produced. Its age is the snapshot's age. */
  renderedAt: string;
};

export default function KidDay({ child, events, today, initialDay, daysBack, daysForward, renderedAt }: Props) {
  const [look, setLook] = useState({ emoji: child.emoji, color: child.color });
  const [editingLook, setEditingLook] = useState(false);
  const a = accent(look.color);
  const aInk = accentInk(look.color);
  const [selected, setSelected] = useState<DayKey>(initialDay);
  const [now, setNow] = useState<Date | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(events.map((e) => [e.id, !!e.doneAt])),
  );
  const [, startTransition] = useTransition();
  const router = useRouter();

  // Time-dependent UI renders only after mount so server and client markup agree.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  // A child's page is left open for hours, so an activity added by a parent has
  // to arrive without anyone reloading. Refetch when the app is brought back to
  // the front — the common case — and periodically while it is being watched.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    // Whichever comes first: the app is brought back to the front, the window
    // regains focus, a reminder arrives, or the poll comes round.
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    navigator.serviceWorker?.addEventListener("message", refresh);
    const t = setInterval(refresh, 30_000);

    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      navigator.serviceWorker?.removeEventListener("message", refresh);
      clearInterval(t);
    };
  }, [router]);

  const days = useMemo(
    () => Array.from({ length: daysBack + daysForward }, (_, i) => shiftDay(today, i - daysBack)),
    [today, daysBack, daysForward],
  );

  const byDay = useMemo(() => {
    const m = new Map<DayKey, KidEvent[]>();
    for (const e of events) {
      const k = dayKeyOf(e.startsAt);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);

  const dayEvents = byDay.get(selected) ?? [];
  const isToday = selected === today;

  const current = now && isToday
    ? dayEvents.find((e) => new Date(e.startsAt) <= now && now < new Date(e.endsAt) && !done[e.id])
    : undefined;
  const next = now && isToday
    ? dayEvents.find((e) => new Date(e.startsAt) > now && !done[e.id])
    : undefined;

  function toggle(e: KidEvent) {
    // Offline the optimistic update would be reverted a moment later by the
    // failed request, which reads as the app ignoring the tap.
    if (offline) return;
    const value = !done[e.id];
    setDone((d) => ({ ...d, [e.id]: value }));
    if (navigator.vibrate) navigator.vibrate(value ? 18 : 8);
    startTransition(() => {
      toggleDoneAction(child.token, e.id, value).then((r) => {
        if (!r.ok) setDone((d) => ({ ...d, [e.id]: !value }));
      });
    });
  }

  /*
   * Register the worker here rather than leaving it to the notifications
   * button. Offline reading depends on it, and the button registers only after
   * clearing two checks that have nothing to do with offline: that push exists
   * — it does not in an iPhone Safari tab — and that permission is not denied.
   * Gating the worker on those meant the children least able to get reminders
   * were also the ones who would never get their calendar offline.
   */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    ensureWorker(child.token);

    // Ask to be exempt from automatic eviction. Safari grants this only where
    // notification permission has been given, which a child who tapped the bell
    // already has — so it tends to succeed for exactly the ones who rely on it.
    navigator.storage?.persist?.().catch(() => {});

    // Store this page as soon as the worker exists, rather than waiting for a
    // second visit. Otherwise installing and immediately losing signal leaves
    // nothing cached at all. "pages-v1" must match VERSION in public/sw.js.
    navigator.serviceWorker.ready
      .then(() => caches.open("pages-v1"))
      .then((cache) => cache.add(location.pathname))
      .catch(() => {});
  }, [child.token]);

  // Once per tab session: enough to keep "last used" honest without a request
  // on every render.
  useEffect(() => {
    const key = `fc-noted-${child.token}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    noteDeviceAction(child.token);
  }, [child.token]);

  // A cached schedule that looks live is worse than no schedule: a child could
  // act on something cancelled hours ago with nothing on screen to say so. So
  // offline is stated, and with an age rather than a vague "offline".
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    /*
     * Two independent signals, because neither is sufficient alone.
     *
     * navigator.onLine answers "is there a network interface", not "can I
     * reach the server" — a phone on wifi with no internet reports online. So
     * the age of this document is checked too: the page re-renders on every
     * poll while the server is reachable, and stops the moment it is not.
     * Beyond three missed polls, what is on screen is a snapshot whatever the
     * browser believes about connectivity.
     */
    const check = () => {
      const age = Date.now() - new Date(renderedAt).getTime();
      setOffline(navigator.onLine === false || age > 90_000);
    };
    check();
    const tick = setInterval(check, 10_000);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, [renderedAt]);

  function remove(e: KidEvent) {
    if (offline) return;
    if (navigator.vibrate) navigator.vibrate(12);
    startTransition(() => {
      deleteOwnEventAction(child.token, e.id).then(() => router.refresh());
    });
  }

  function saveLook(patch: Partial<typeof look>) {
    const previous = look;
    const next = { ...look, ...patch };
    setLook(next);
    startTransition(() => {
      updateLookAction(child.token, next.emoji, next.color).then((r) => {
        if (!r.ok) setLook(previous);
      });
    });
  }

  function step(delta: number) {
    const i = days.indexOf(selected) + delta;
    if (i >= 0 && i < days.length) setSelected(days[i]);
  }

  const touch = useRef<{ x: number; y: number } | null>(null);

  const remaining = dayEvents.filter((e) => !done[e.id]).length;

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col"
      style={{ ["--accent" as string]: a }}
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
    >
      <header className="safe-top px-4 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditingLook((v) => !v)}
            aria-label="Change your emoji and colour"
            aria-expanded={editingLook}
            className="grid size-11 shrink-0 place-items-center rounded-2xl text-xl transition active:scale-95"
            style={{ background: `color-mix(in oklch, ${a} 22%, transparent)` }}
          >
            {look.emoji}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold text-fg-2">Hi {child.name}</h1>
            <p className="truncate text-[26px] font-extrabold leading-tight">{fmtDayLabel(selected, today)}</p>
          </div>
          <EnableNotifications token={child.token} accent={a} />
        </div>
      </header>

      {offline && <OfflineNotice renderedAt={renderedAt} />}
      <InstallHint accent={a} />

      {editingLook && (
        <section aria-label="Your look" className="rise mx-4 mb-4 rounded-3xl bg-card p-4">
          <div className="flex items-center gap-3">
            <p className="flex-1 text-[15px] font-semibold text-fg-2">Pick your animal</p>
            <button
              onClick={() => setEditingLook(false)}
              className="rounded-full px-4 py-1.5 text-[15px] font-bold text-on-accent"
              style={{ background: a }}
            >
              Done
            </button>
          </div>

          <div className="mt-3 grid grid-cols-6 gap-2">
            {AVATARS.map((e) => (
              <button
                key={e}
                onClick={() => saveLook({ emoji: e })}
                aria-label={e}
                aria-pressed={e === look.emoji}
                className="grid aspect-square place-items-center rounded-2xl bg-raised text-xl transition active:scale-90"
                style={e === look.emoji ? { background: `color-mix(in oklch, ${a} 35%, transparent)`, boxShadow: `inset 0 0 0 2px ${a}` } : undefined}
              >
                {e}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            {ACCENT_NAMES.map((n) => (
              <button
                key={n}
                onClick={() => saveLook({ color: n })}
                aria-label={n}
                aria-pressed={n === look.color}
                className="h-9 flex-1 rounded-2xl transition active:scale-95"
                style={{ background: accent(n), boxShadow: n === look.color ? "0 0 0 3px var(--color-fg)" : "none" }}
              />
            ))}
          </div>
        </section>
      )}

      <nav aria-label="Days" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-4">
        {days.map((d) => {
          const on = d === selected;
          const count = (byDay.get(d) ?? []).length;
          return (
            <button
              key={d}
              onClick={() => setSelected(d)}
              aria-label={fmtDayLabel(d, today)}
              aria-current={on ? "date" : undefined}
              className={`flex w-13 shrink-0 flex-col items-center gap-0.5 rounded-2xl px-2 py-2.5 transition ${
                on ? "text-on-accent" : "bg-card text-fg-2"
              }`}
              style={on ? { background: a, color: "oklch(0.20 0.012 280)" } : undefined}
            >
              <span className="text-[12px] font-semibold uppercase tracking-wide opacity-70">
                {d === today ? "Now" : fmtWeekday(d)}
              </span>
              <span className="text-lg font-bold leading-none tabular-nums">{dayOfMonth(d)}</span>
              <span
                className={`mt-0.5 h-1 w-1 rounded-full ${count ? "" : "opacity-0"}`}
                style={{ background: on ? "currentColor" : a }}
                aria-hidden
              />
            </button>
          );
        })}
      </nav>

      <div className="flex-1 px-4">
        {current && (
          <Hero
            kind="now"
            event={current}
            accentColor={a}
            accentInkColor={aInk}
            now={now!}
            onToggle={() => toggle(current)}
          />
        )}
        {!current && next && (
          <Hero kind="next" event={next} accentColor={a} accentInkColor={aInk} now={now!} onToggle={() => toggle(next)} />
        )}

        {/* The highlight is a call-out, not a substitute: the list stays the
            whole day in order, or it reads as though something is missing. The
            highlighted row is ringed so the two are visibly the same thing. */}
        {dayEvents.length === 0 ? (
          <Empty isToday={isToday} />
        ) : (
          <ol aria-label="Schedule" className="mt-5 space-y-2 pb-4">
            {dayEvents.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                done={!!done[e.id]}
                accentColor={a}
                highlighted={e.id === current?.id || e.id === next?.id}
                past={!!now && new Date(e.endsAt) <= now && isToday}
                onToggle={() => toggle(e)}
                onRemove={e.mine && !offline ? () => remove(e) : undefined}
              />
            ))}
          </ol>
        )}

        {!offline && <AddOwn token={child.token} day={selected} accentColor={a} />}
      </div>

      <footer className="safe-bottom px-4 pt-2 text-center text-[15px] text-fg-3">
        {dayEvents.length === 0
          ? "Swipe to see other days"
          : remaining === 0
            ? "All done for the day 🎉"
            : `${remaining} to go · tap when done`}
      </footer>
    </main>
  );
}

function Hero({
  kind,
  event,
  accentColor,
  accentInkColor,
  now,
  onToggle,
}: {
  kind: "now" | "next";
  event: KidEvent;
  accentColor: string;
  accentInkColor: string;
  now: Date;
  onToggle: () => void;
}) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const pct =
    kind === "now"
      ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
      : 0;

  return (
    <section
      aria-label="Highlight"
      className="rise relative overflow-hidden rounded-3xl p-4"
      style={{
        background: `linear-gradient(160deg, color-mix(in oklch, ${accentColor} 26%, transparent), color-mix(in oklch, ${accentColor} 8%, transparent))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${accentColor} 32%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em]" style={{ color: accentInkColor }}>
        {kind === "now" && <span className="now-dot inline-block size-2 rounded-full" style={{ background: accentInkColor }} />}
        {kind === "now" ? "Happening now" : "Next up"}
      </div>

      <div className="mt-3 flex items-start gap-3">
        <span className="text-4xl leading-none" aria-hidden>
          {event.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[30px] font-bold leading-tight">{event.title}</h2>
          <p className="mt-1 text-[17px] text-fg-2 tabular-nums">
            {fmtTime(event.startsAt)}–{fmtTime(event.endsAt)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[18px] font-bold" style={{ color: accentInkColor }}>
        {kind === "now"
          ? `${humanCountdown(minutesUntil(event.endsAt, now)).replace("in ", "")} left`
          : humanCountdown(minutesUntil(event.startsAt, now))}
      </p>

      {kind === "now" && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="presentation">
          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: accentInkColor }} />
        </div>
      )}

      <button
        onClick={onToggle}
        className="mt-4 w-full rounded-2xl py-3 text-[17px] font-bold text-on-accent active:scale-[0.98] transition"
        style={{ background: accentColor }}
      >
        Mark done
      </button>
    </section>
  );
}

function EventRow({
  event,
  done,
  accentColor,
  highlighted,
  past,
  onToggle,
  onRemove,
}: {
  event: KidEvent;
  done: boolean;
  accentColor: string;
  highlighted: boolean;
  past: boolean;
  onToggle: () => void;
  /** Present only on the child's own entries — those are the only removable ones. */
  onRemove?: () => void;
}) {
  const mine = !!onRemove;
  return (
    <li className="flex items-center gap-2">
      {/* What a parent put there is the instruction; what the child added is
          their own note. One list in time order so the day still reads as a
          day, with the parent's entries carrying the weight: a filled card and
          heavy type against an outline and lighter type. */}
      <button
        onClick={onToggle}
        aria-pressed={done}
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-3xl p-3 text-left transition active:scale-[0.985] ${
          mine ? "bg-transparent" : "bg-card"
        } ${done ? "opacity-40" : past ? "opacity-60" : ""}`}
        style={
          highlighted && !done
            ? { boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${accentColor} 45%, transparent)` }
            : mine
              ? { boxShadow: "inset 0 0 0 1.5px var(--color-line)" }
              : undefined
        }
      >
        <div className="w-12 shrink-0 text-center">
          <div className={`tabular-nums leading-tight ${mine ? "text-[16px] font-semibold text-fg-2" : "text-[18px] font-bold"}`}>
            {fmtTime(event.startsAt)}
          </div>
          <div className="text-[12px] tabular-nums text-fg-3">{fmtTime(event.endsAt)}</div>
        </div>
        <span className={mine ? "text-xl leading-none" : "text-2xl leading-none"} aria-hidden>
          {event.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`truncate ${mine ? "text-[17px] font-semibold text-fg-2" : "text-[19px] font-bold"} ${done ? "line-through" : ""}`}
          >
            {event.title}
          </div>
          {event.location && <div className="truncate text-[15px] text-fg-2">{event.location}</div>}
        </div>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full text-on-accent transition"
          style={{ background: done ? accentColor : "transparent", boxShadow: done ? "none" : "inset 0 0 0 2px var(--color-line)" }}
          aria-hidden
        >
          {done ? "✓" : ""}
        </span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${event.title}`}
          className="grid size-9 shrink-0 place-items-center rounded-2xl text-[17px] text-fg-3 transition active:scale-90"
        >
          ✕
        </button>
      )}
    </li>
  );
}

function Empty({ isToday }: { isToday: boolean }) {
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <div className="text-5xl" aria-hidden>
        🌤️
      </div>
      <p className="mt-4 text-lg font-semibold">Nothing planned</p>
      <p className="mt-1 text-[17px] text-fg-2">{isToday ? "Enjoy your free day." : "This day is free."}</p>
    </div>
  );
}

/** 06:00 to 22:00 in half hours — the span a child's day actually occupies. */
const SLOTS = Array.from({ length: 33 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/**
 * A child adding something of their own.
 *
 * One topic and one time. No end time, no repeat, no location: an hour is
 * assumed, because a child adding "football at four" is not thinking in
 * durations, and every extra field is a step back toward the adult calendar
 * this app exists to not be.
 */
function AddOwn({ token, day, accentColor }: { token: string; day: DayKey; accentColor: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function close() {
    setOpen(false);
    setTitle("");
    setSlot(null);
    setError(null);
  }

  function save() {
    if (!title.trim() || !slot) return;
    startSaving(() => {
      addOwnEventAction(token, day, slot, title).then((r) => {
        if (r.ok) {
          if (navigator.vibrate) navigator.vibrate(18);
          close();
          router.refresh();
        } else setError(r.error ?? "Could not add that");
      });
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 mb-4 w-full rounded-3xl py-3.5 text-[17px] font-semibold text-fg-2 transition active:scale-[0.99]"
        style={{ boxShadow: "inset 0 0 0 1.5px var(--color-line)" }}
      >
        + Add your own
      </button>
    );
  }

  return (
    <section aria-label="Add your own" className="mt-3 mb-4 rounded-3xl bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {KID_PICKS.map((k) => (
          <button
            key={k.title}
            onClick={() => setTitle(k.title)}
            aria-pressed={title === k.title}
            className={`rounded-2xl px-3 py-2 text-[16px] font-semibold transition active:scale-95 ${
              title === k.title ? "text-on-accent" : "bg-raised text-fg-2"
            }`}
            style={title === k.title ? { background: accentColor, color: "oklch(0.20 0.012 280)" } : undefined}
          >
            <span aria-hidden>{k.emoji}</span> {k.title}
          </button>
        ))}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="…or type it"
        aria-label="What is it"
        maxLength={40}
        className="mt-3 w-full rounded-2xl bg-raised px-4 py-3 text-[18px] outline-none placeholder:text-fg-3"
      />

      {/* A vertical list rather than a time picker: no AM/PM to get wrong, and
          tapping a half hour is one gesture where a wheel is several. */}
      <div className="mt-3 max-h-56 overflow-y-auto rounded-2xl bg-raised p-1" role="listbox" aria-label="Time">
        {SLOTS.map((t) => (
          <button
            key={t}
            role="option"
            aria-selected={slot === t}
            onClick={() => setSlot(t)}
            className={`w-full rounded-xl px-3 py-2.5 text-left text-[17px] tabular-nums transition ${
              slot === t ? "font-bold text-on-accent" : "text-fg"
            }`}
            style={slot === t ? { background: accentColor, color: "oklch(0.20 0.012 280)" } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[15px] font-semibold text-kid-rose-ink">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={saving || !title.trim() || !slot}
          className="flex-1 rounded-2xl py-3.5 text-[17px] font-bold text-on-accent transition active:scale-[0.99] disabled:opacity-50"
          style={{ background: accentColor, color: "oklch(0.20 0.012 280)" }}
        >
          {saving ? "Adding…" : slot ? `Add at ${slot}` : "Pick a time"}
        </button>
        <button onClick={close} className="rounded-2xl px-5 text-[17px] font-semibold text-fg-2">
          Cancel
        </button>
      </div>
    </section>
  );
}

/** How stale the snapshot is, in words a child reads without thinking. */
function ageOf(renderedAt: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(renderedAt).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function OfflineNotice({ renderedAt }: { renderedAt: string }) {
  return (
    <section aria-label="Offline" className="mx-4 mb-3 rounded-3xl bg-card p-4">
      <p className="text-[17px] font-bold">You are offline</p>
      <p className="mt-1 text-[15px] text-fg-2">
        This is how your day looked {ageOf(renderedAt)}. It may have changed since.
      </p>
    </section>
  );
}

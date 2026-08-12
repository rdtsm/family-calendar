import type { Metadata } from "next";
import { isParent } from "@/lib/auth";
import { allEventsInRange, deviceCounts, listPeople, unconfirmedDevices } from "@/lib/queries";
import { confirmDevicesAction } from "./actions";
import { dayWindow, fmtAgo, shiftDay, todayKey } from "@/lib/time";
import { HORIZON_WEEKS } from "@/lib/recurrence";
import Link from "next/link";
import PinScreen from "./PinScreen";
import AddEvent from "./AddEvent";
import Agenda from "./Agenda";
import InstallApp from "./InstallApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ParentPage() {
  if (!(await isParent())) return <PinScreen />;

  const people = await listPeople();
  // An observer is never picked for an activity — they receive the whole
  // household regardless, so offering them would only invite a pointless choice.
  const children = people.filter((p) => p.kind !== "observer");
  const devices = await deviceCounts();
  // A new device is an event worth naming; the running total is not. Nothing is
  // blocked by this — no link is bound to a device — so it warns rather than gates.
  const unconfirmed = await unconfirmedDevices();
  // Only worth saying when it is wrong — a permanent "all fine" banner is noise.
  const silent = people.filter((c) => c.kind === "child" && !devices[c.id]);
  const today = todayKey();
  const start = dayWindow(today).start;
  // A full year, matching how far a weekly repeat is materialised. The agenda
  // reveals it a few weeks at a time rather than rendering it all at once.
  const end = dayWindow(shiftDay(today, HORIZON_WEEKS * 7)).end;
  const events = await allEventsInRange(start, end);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16">
      <header className="safe-top flex items-center justify-between gap-3 pb-6">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-tight">Family Calendar</h1>
          <p className="text-[17px] text-fg-2">Set the kids&apos; week</p>
        </div>
        <Link
          href="/parent/kids"
          aria-label="Manage family"
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-fg-2 transition active:scale-95"
        >
          <span aria-hidden className="text-lg leading-none">☰</span>
        </Link>
      </header>

      {silent.length > 0 && children.length > 0 && (
        <Link
          href="/parent/kids"
          className="mb-4 block rounded-3xl bg-card p-4 text-[15px]"
          style={{ boxShadow: "inset 4px 0 0 0 var(--color-kid-rose-ink)" }}
        >
          <span className="font-semibold text-kid-rose-ink">
            {silent.map((c) => c.name).join(" and ")} {silent.length === 1 ? "has" : "have"} reminders off
          </span>
          <span className="block text-fg-2">Tap to see how to turn them on</span>
        </Link>
      )}

      {unconfirmed.map((d) => {
        const who = people.find((p) => p.id === d.child_id);
        if (!who) return null;
        return (
          <section
            key={d.child_id}
            aria-label={`New device for ${who.name}`}
            className="mb-4 rounded-3xl bg-card p-4"
            style={{ boxShadow: "inset 4px 0 0 0 var(--color-kid-rose-ink)" }}
          >
            <p className="text-[17px] font-semibold">
              {d.n === 1 ? "A new device opened" : `${d.n} new devices opened`} {who.name}&apos;s link
              <span className="font-normal text-fg-2"> · {fmtAgo(d.latest)}</span>
            </p>
            <p className="mt-1 text-[15px] text-fg-2">
              Usually a new phone, a reinstall, or a private window. If you were not expecting it,
              replace the link — <strong>you will then need to send {who.name} the new link</strong>,
              and they add it to their home screen and tap 🔔 again.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <form action={confirmDevicesAction}>
                <input type="hidden" name="id" value={d.child_id} />
                <button className="rounded-2xl bg-fg px-4 py-2.5 text-[17px] font-bold text-surface transition active:scale-[0.98]">
                  That was us
                </button>
              </form>
              <Link
                href={`/parent/kids/${d.child_id}`}
                className="rounded-2xl bg-raised px-4 py-2.5 text-[17px] font-semibold text-fg transition active:scale-[0.98]"
              >
                Replace {who.name}&apos;s link
              </Link>
            </div>
          </section>
        );
      })}

      {/* Below the two warnings above, which are urgent and dated, and above the
          week itself. Onboarding should never outrank a child whose reminders
          are off. */}
      <InstallApp />

      {children.length === 0 ? (
        <Link href="/parent/kids" className="block rounded-3xl bg-card p-6 text-center">
          <p className="text-lg font-semibold">Add your first family member</p>
          <p className="mt-1 text-[17px] text-fg-2">Kids get an app; adults get a calendar to subscribe to.</p>
        </Link>
      ) : (
        <AddEvent children={children} today={today} />
      )}

      <Agenda
        children={people.filter((p) => p.kind !== "observer")}
        events={events.map((e) => ({
          id: e.id,
          childId: e.child_id,
          title: e.title,
          emoji: e.emoji,
          location: e.location,
          startsAt: new Date(e.starts_at).toISOString(),
          endsAt: new Date(e.ends_at).toISOString(),
          seriesId: e.series_id,
          groupId: e.group_id,
          doneAt: e.done_at ? new Date(e.done_at).toISOString() : null,
        }))}
        today={today}
      />
    </main>
  );
}

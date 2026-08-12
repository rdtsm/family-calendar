import Link from "next/link";
import type { Metadata } from "next";
import { isParent } from "@/lib/auth";
import { deviceCounts, listPeople } from "@/lib/queries";
import { accent } from "@/lib/colors";
import PinScreen from "../PinScreen";
import AddChild from "./AddChild";
import ShareManager from "./ShareManager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function KidsPage() {
  if (!(await isParent())) return <PinScreen />;
  const children = await listPeople();
  const devices = await deviceCounts();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16">
      <header className="safe-top flex items-center gap-3 pb-6">
        <Link
          href="/parent"
          aria-label="Back to the calendar"
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-lg text-fg-2"
        >
          ←
        </Link>
        <h1 className="text-[26px] font-bold leading-tight">Manage family</h1>
      </header>

      <ul aria-label="Family" className="space-y-2">
        {children.map((c) => (
          <li key={c.id}>
            <Link
              href={`/parent/kids/${c.id}`}
              className="flex items-center gap-3 rounded-2xl bg-card p-4 transition active:scale-[0.99]"
              style={{ boxShadow: `inset 4px 0 0 0 ${accent(c.color)}` }}
            >
              <span className="text-2xl" aria-hidden>
                {c.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-semibold">{c.name}</span>
                <span
                  className={`block text-[15px] ${
                    c.kind === "child" && !devices[c.id] ? "text-kid-rose-ink" : "text-fg-2"
                  }`}
                >
                  {c.kind === "child"
                    ? devices[c.id]
                      ? "Reminders on"
                      : "Reminders off"
                    : c.kind === "observer"
                      ? c.last_fetched_at
                        ? "Watching · calendar subscribed"
                        : "Watching · not subscribed yet"
                      : c.last_fetched_at
                        ? "Taking part · calendar subscribed"
                        : "Taking part · not subscribed yet"}
                </span>
              </span>
              <span className="text-fg-3" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {children.length === 0 && (
        <p className="rounded-3xl bg-card p-6 text-center text-[17px] text-fg-2">
          Nobody yet. Add the first person below.
        </p>
      )}

      <AddChild />

      <ShareManager />

      <Link
        href="/parent/settings"
        className="mt-8 flex items-center gap-2 text-[17px] font-semibold text-fg-2"
      >
        Change PIN <span aria-hidden>›</span>
      </Link>
    </main>
  );
}

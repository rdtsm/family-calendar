import Link from "next/link";
import type { Metadata } from "next";
import { isParent } from "@/lib/auth";
import PinScreen from "../PinScreen";
import ChangePin from "./ChangePin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SettingsPage() {
  if (!(await isParent())) return <PinScreen />;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16">
      <header className="safe-top flex items-center gap-3 pb-6">
        <Link
          href="/parent/kids"
          aria-label="Back to kids"
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-lg text-fg-2"
        >
          ←
        </Link>
        <h1 className="text-[24px] font-bold leading-tight">PIN</h1>
      </header>

      <section aria-label="Change PIN">
        {/* "Every device" read as though it might include the children's phones.
            It never did — the PIN guards this app alone — so the copy names
            which app, and what is untouched is listed rather than inferred. */}
        <p className="mb-4 text-[17px] text-fg-2">
          The PIN guards <strong>this app</strong> — the one you plan the week in. Changing it signs
          out every phone or computer signed in here, including this one, though you will be signed
          straight back in. Change it if someone has seen the PIN who should not have.
        </p>
        <ChangePin />
      </section>

      <section aria-label="What a new PIN does not change" className="mt-8">
        <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">
          What it does not change
        </h2>
        <ul className="space-y-2 text-[15px] text-fg-2">
          <li>
            <strong className="text-fg">The children&apos;s apps keep working.</strong> Their links
            are separate credentials and a new PIN does not touch them. To replace one, open the
            child and tap <strong>Replace this link</strong>.
          </li>
          <li>
            <strong className="text-fg">Adults&apos; subscribed calendars keep updating.</strong>{" "}
            Anyone setting one up from now on will need the new PIN, because the page that hands out
            a calendar asks for it.
          </li>
        </ul>
      </section>
    </main>
  );
}

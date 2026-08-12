import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isParent } from "@/lib/auth";
import { childById, deviceCounts, linkOpens } from "@/lib/queries";
import { accent } from "@/lib/colors";
import PinScreen from "../../PinScreen";
import Profile from "./Profile";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isParent())) return <PinScreen />;

  const { id } = await params;
  const child = await childById(id);
  if (!child) notFound();

  const devices = (await deviceCounts())[child.id] ?? 0;
  const opens = await linkOpens(child.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16">
      <header className="safe-top flex items-center gap-3 pb-6">
        <Link
          href="/parent/kids"
          aria-label="Back to the family list"
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-lg text-fg-2"
        >
          ←
        </Link>
        <span
          className="grid size-11 shrink-0 place-items-center rounded-2xl text-xl"
          style={{ background: `color-mix(in oklch, ${accent(child.color)} 22%, transparent)` }}
          aria-hidden
        >
          {child.emoji}
        </span>
        <h1 className="truncate text-[26px] font-bold leading-tight">{child.name}</h1>
      </header>

      <Profile
        id={child.id}
        name={child.name}
        token={child.token}
        kind={child.kind}
        lastFetchedAt={child.last_fetched_at}
        devices={devices}
        opens={opens}
      />
    </main>
  );
}

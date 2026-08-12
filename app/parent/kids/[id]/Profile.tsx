"use client";

import { useActionState, useEffect, useState } from "react";
import type { Kind } from "@/lib/db";
import {
  deleteChildAction,
  forgetDevicesAction,
  renameChildAction,
  rotateLinkAction,
  type FormState,
} from "../../actions";

export default function Profile({
  id,
  name,
  token,
  kind,
  lastFetchedAt,
  devices,
  opens,
}: {
  id: string;
  name: string;
  token: string;
  kind: Kind;
  lastFetchedAt: string | null;
  devices: number;
  opens: { n: number; last: string | null };
}) {
  const isChild = kind === "child";
  const [state, rename, renaming] = useActionState<FormState, FormData>(renameChildAction, {});
  const [rotated, rotate, rotating] = useActionState<FormState, FormData>(rotateLinkAction, {});
  const [forgotten, forget, forgetting] = useActionState<FormState, FormData>(forgetDevicesAction, {});
  const [confirming, setConfirming] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  const [origin, setOrigin] = useState("");

  // The link has to be absolute to be shareable, and only the browser knows the host.
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}${isChild ? "/k/" : "/cal/"}${token}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setShared("copied");
      setTimeout(() => setShared("idle"), 1800);
    } catch {
      /* clipboard blocked — the link is printed below either way */
    }
  }

  async function share() {
    // The native sheet puts WhatsApp, Messages and AirDrop one tap away. Where
    // there is no share sheet the button copies instead, so it is never a
    // control that does nothing.
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${name}'s calendar`,
          text: isChild
            ? `${name} — here's your calendar. Open it and add it to your home screen.`
            : `${name} — add the family calendar to your own. You'll need the family PIN.`,
          url,
        });
      } catch {
        /* cancelled — not an error worth reporting */
      }
      return;
    }
    await copy();
  }

  return (
    <div className="space-y-8">
      <section aria-label="Name">
        <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">Name</h2>
        <form action={rename} className="flex gap-2">
          <input type="hidden" name="id" value={id} />
          <input
            name="name"
            defaultValue={name}
            aria-label="Child's name"
            autoComplete="off"
            className="w-full rounded-2xl bg-card px-4 py-3.5 text-[18px] outline-none"
          />
          <button
            disabled={renaming}
            className="shrink-0 rounded-2xl bg-fg px-5 text-[17px] font-bold text-surface disabled:opacity-60"
          >
            {renaming ? "…" : "Save"}
          </button>
        </form>
        {state.error && (
          <p role="alert" className="mt-2 text-[15px] font-semibold text-kid-rose-ink">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="mt-2 text-[15px] font-semibold text-kid-mint-ink">
            {state.ok}
          </p>
        )}
      </section>

      <section aria-label="Their link">
        <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">Their link</h2>
        <p className="mb-3 text-[15px] text-fg-2">
          {isChild
            ? `This link is ${name}'s whole login — no password. Send it to their phone, then they add it to their home screen.`
            : `Send this to ${name}. It asks for the family PIN, then offers their calendar app one tap to subscribe.`}
        </p>

        <div className="space-y-2">
          <button
            onClick={share}
            className="w-full rounded-2xl bg-kid-violet py-4 text-[17px] font-bold text-on-accent transition active:scale-[0.99]"
          >
            Share link
          </button>
          <button
            onClick={copy}
            className="w-full rounded-2xl bg-raised py-4 text-[17px] font-semibold text-fg transition active:scale-[0.99]"
          >
            {shared === "copied" ? "Copied ✓" : "Copy link"}
          </button>
          <a
            href={`${isChild ? "/k/" : "/cal/"}${token}`}
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-2xl bg-raised py-4 text-center text-[17px] font-semibold text-fg transition active:scale-[0.99]"
          >
            Open link
          </a>
        </div>

        <p className="mt-3 break-all rounded-2xl bg-card p-3 text-[13px] text-fg-3">
          {url || `${isChild ? "/k/" : "/cal/"}${token}`}
        </p>

        {rotated.ok && (
          /* A new link is useless until it is sent, and the old one is already
             dead — so this states the next action rather than the last one, or
             the button gets pressed again in the hope of something happening. */
          <div role="status" className="mt-3 rounded-3xl bg-card p-4">
            <p className="text-[17px] font-bold text-kid-mint-ink">New link created ✓</p>
            <p className="mt-1 text-[17px]">
              <strong>Now send it to {name}.</strong> Use <strong>Share link</strong> above — the
              address on this page has already changed to the new one.
            </p>
            <p className="mt-1 text-[15px] text-fg-2">
              {isChild
                ? `Their old link stopped working immediately, and their reminders are off until they open the new link and tap 🔔 again.`
                : `Their old subscription stopped updating immediately, and they will need to add the calendar again.`}
            </p>
          </div>
        )}

        <div className="mt-4 rounded-2xl bg-card p-3">
          <h3 className="text-[17px] font-bold">Who has opened this link</h3>
          <p className="mt-1 text-[17px]">
            {opens.n === 0 ? (
              <span className="text-fg-2">Nothing counted yet.</span>
            ) : (
              <>
                <strong>
                  {opens.n} {opens.n === 1 ? "browser" : "browsers"}.
                </strong>{" "}
                <span className="text-fg-2">
                  Last opened {opens.last ? new Date(opens.last).toLocaleString() : "\u2014"}.
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-[15px] text-fg-2">
            More than you expect means somebody else has the link. Use <strong>Replace this link</strong>{" "}
            to stop it working.
          </p>
          <p className="mt-1 text-[15px] text-fg-3">
            Browsers, not people: {name}&apos;s new phone or a private window each add one.
          </p>
          {forgotten.ok ? (
            <p role="status" className="mt-2 text-[15px] font-semibold text-kid-mint-ink">
              {forgotten.ok}
            </p>
          ) : (
            opens.n > 0 && (
              <form action={forget} className="mt-2">
                <input type="hidden" name="id" value={id} />
                <button disabled={forgetting} className="text-[15px] font-semibold text-fg-2 disabled:opacity-60">
                  {forgetting ? "\u2026" : "Start counting again"}
                </button>
              </form>
            )
          )}
        </div>

        {confirmingRotate ? (
          <form action={rotate} className="mt-3 rounded-3xl bg-card p-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-[17px]">
              Give {name} a new link? The current one stops working immediately, and their
              home-screen app will need adding again. Their activities and history stay.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                disabled={rotating}
                className="rounded-2xl bg-kid-rose/25 px-4 py-2.5 text-[17px] font-bold text-kid-rose-ink disabled:opacity-60"
              >
                {rotating ? "…" : "New link"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRotate(false)}
                className="rounded-2xl px-4 py-2.5 text-[17px] font-semibold text-fg-2"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setConfirmingRotate(true)}
            className="mt-3 text-[15px] font-semibold text-fg-2"
          >
            Replace this link
          </button>
        )}
      </section>

      {!isChild ? (
        <section aria-label="Their calendar">
          <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">
            Their calendar
          </h2>
          {lastFetchedAt ? (
            <p className="text-[17px]">
              <strong>Subscribed.</strong> Their calendar app last checked{" "}
              {new Date(lastFetchedAt).toLocaleString()}.{" "}
              {kind === "observer"
                ? "They see everything the family has on."
                : "They see the activities they’re on."}
            </p>
          ) : (
            <div className="rounded-3xl bg-card p-4">
              <p className="text-[17px] font-semibold text-kid-rose-ink">
                Not subscribed yet — nothing is reaching {name}.
              </p>
              <p className="mt-1 text-[15px] text-fg-2">
                Share the link above. Once their calendar app fetches it, the time shows here.
              </p>
            </div>
          )}
          <p className="mt-2 text-[15px] text-fg-3">
            A subscribed calendar sends no notifications, and does not make them look busy to anyone
            scheduling a meeting. It refreshes roughly hourly on Apple, every few hours on Outlook,
            and up to once a day on Google.
          </p>
        </section>
      ) : (
      <section aria-label="Reminders">
        <h2 className="mb-2 text-[15px] font-bold uppercase tracking-[0.14em] text-fg-2">Reminders</h2>
        {devices > 0 ? (
          <>
            <p className="text-[17px]">
              <strong>On.</strong> {name}&apos;s {devices === 1 ? "phone buzzes" : `${devices} phones buzz`} an
              hour before each activity, again five minutes before, and with a summary each morning.
            </p>
            <p className="mt-2 text-[15px] text-fg-2">
              We can only see that a phone asked for reminders. We cannot tell whether it is on
              silent, or whether notifications were switched off later.
            </p>
          </>
        ) : (
          <div className="rounded-3xl bg-card p-4">
            <p className="text-[17px] font-semibold text-kid-rose-ink">Off — {name} gets no reminders.</p>
            <p className="mt-1 text-[15px] text-fg-2">
              Ask {name} to open their calendar and tap the 🔔 in the top corner. On iPhone the
              calendar has to be on the home screen first, or the bell will not appear at all.
            </p>
          </div>
        )}
      </section>
      )}

      <section aria-label="Remove">
        {confirming ? (
          <form action={deleteChildAction} className="rounded-3xl bg-card p-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-[17px]">
              Remove <strong>{name}</strong>? Their activities and link go too. This cannot be undone.
            </p>
            <div className="mt-3 flex gap-2">
              <button className="rounded-2xl bg-kid-rose/25 px-4 py-2.5 text-[17px] font-bold text-kid-rose-ink">
                Remove {name}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-2xl px-4 py-2.5 text-[17px] font-semibold text-fg-2"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-[15px] font-semibold text-fg-2">
            Remove {name}
          </button>
        )}
      </section>
    </div>
  );
}

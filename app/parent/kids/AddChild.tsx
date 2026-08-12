"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { accent, ACCENT_NAMES, AVATARS } from "@/lib/colors";
import type { Kind } from "@/lib/db";
import { addChildAction, type FormState } from "../actions";

const ROLES: { kind: Kind; label: string; hint: string }[] = [
  { kind: "child", label: "+ Add child", hint: "Gets the app on their phone, with a reminder before each activity." },
  {
    kind: "participant",
    label: "+ Add adult · taking part",
    hint: "Picked when you add an activity, and sees just those in their own calendar app.",
  },
  {
    kind: "observer",
    label: "+ Add adult · watching",
    hint: "Sees everything the family has on. Never picked when adding an activity — they get it all anyway.",
  },
];

export default function AddChild() {
  const [state, action, pending] = useActionState<FormState, FormData>(addChildAction, {});
  const [kind, setKind] = useState<Kind | null>(null);
  const [emoji, setEmoji] = useState<string>(AVATARS[0]);
  const [color, setColor] = useState<string>(ACCENT_NAMES[0]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setKind(null);
    }
  }, [state.ok]);

  if (!kind) {
    return (
      <div className="mt-6 space-y-2">
        {ROLES.map((r) => (
          <button
            key={r.kind}
            onClick={() => setKind(r.kind)}
            className="w-full rounded-2xl bg-card px-4 py-4 text-left transition active:scale-[0.99]"
          >
            <span className="block text-[17px] font-semibold text-fg-2">{r.label}</span>
            <span className="mt-0.5 block text-[15px] text-fg-3">{r.hint}</span>
          </button>
        ))}
      </div>
    );
  }

  const role = ROLES.find((r) => r.kind === kind)!;

  return (
    <form ref={formRef} action={action} className="mt-6 space-y-4 rounded-3xl bg-card p-4">
      <input type="hidden" name="emoji" value={emoji} />
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="kind" value={kind} />

      <p className="text-[15px] text-fg-2">{role.hint}</p>

      <input
        name="name"
        placeholder="Name"
        autoComplete="off"
        autoFocus
        className="w-full rounded-2xl bg-raised px-4 py-3.5 text-[18px] outline-none placeholder:text-fg-3"
      />

      <div className="grid grid-cols-6 gap-2">
        {AVATARS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEmoji(e)}
            aria-label={e}
            aria-pressed={e === emoji}
            className="grid aspect-square place-items-center rounded-2xl bg-raised text-xl transition active:scale-90"
            style={e === emoji ? { boxShadow: `inset 0 0 0 2px ${accent(color)}` } : undefined}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {ACCENT_NAMES.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setColor(n)}
            aria-label={n}
            aria-pressed={n === color}
            className="h-10 flex-1 rounded-2xl transition active:scale-95"
            style={{ background: accent(n), boxShadow: n === color ? "0 0 0 3px var(--color-fg)" : "none" }}
          />
        ))}
      </div>

      {state.error && (
        <p role="alert" className="text-[15px] font-semibold text-kid-rose-ink">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button disabled={pending} className="flex-1 rounded-2xl bg-fg py-3.5 text-[17px] font-bold text-surface disabled:opacity-60">
          {pending ? "Adding…" : kind === "child" ? "Add child" : "Add adult"}
        </button>
        <button
          type="button"
          onClick={() => setKind(null)}
          className="rounded-2xl px-5 text-[17px] font-semibold text-fg-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

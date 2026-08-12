"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "./actions";

export default function PinScreen({ next, lead }: { next?: string; lead?: string } = {}) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4">
      <div className="text-5xl" aria-hidden>
        🗓️
      </div>
      <h1 className="mt-4 text-[28px] font-bold leading-tight">Family Calendar</h1>
      <p className="mt-1 text-[17px] text-fg-2">{lead ?? "Enter your PIN to plan the week."}</p>

      <form action={action} className="mt-8 space-y-3">
        {next && <input type="hidden" name="next" value={next} />}
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          placeholder="••••••"
          aria-label="Family PIN"
          className="w-full rounded-2xl bg-card px-4 py-4 text-center text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-kid-violet-ink"
        />
        {state.error && (
          <p role="alert" className="text-center text-[15px] font-semibold text-kid-rose-ink">
            {state.error}
          </p>
        )}
        <button
          disabled={pending}
          className="w-full rounded-2xl bg-kid-violet py-4 text-[17px] font-bold text-on-accent transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

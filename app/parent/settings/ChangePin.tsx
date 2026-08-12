"use client";

import { useActionState, useRef, useEffect } from "react";
import { changePinAction, type FormState } from "../actions";

export default function ChangePin() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePinAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <Field name="current" label="Current PIN" />
      <Field name="next" label="New PIN" />
      <Field name="confirm" label="Repeat new PIN" />

      {state.error && (
        <p role="alert" className="text-[15px] font-semibold text-kid-rose-ink">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-[15px] font-semibold text-kid-mint-ink">
          {state.ok}
        </p>
      )}

      <button
        disabled={pending}
        className="w-full rounded-2xl bg-kid-violet py-4 text-[17px] font-bold text-on-accent transition active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? "Changing…" : "Change PIN"}
      </button>
    </form>
  );
}

function Field({ name, label }: { name: string; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[15px] font-semibold text-fg-2">{label}</span>
      <input
        name={name}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        className="w-full rounded-2xl bg-card px-4 py-3.5 text-center text-2xl tracking-[0.3em] outline-none"
      />
    </label>
  );
}

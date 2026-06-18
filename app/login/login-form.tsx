"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="focus-ring w-full rounded-md bg-accent py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction] = useFormState(login, initialState);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-line bg-white p-6">
      <input type="hidden" name="next" value={nextPath ?? "/leads"} />
      <div>
        <label htmlFor="username" className="mb-1 block text-xs font-medium text-ink/70">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          className="focus-ring w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium text-ink/70">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="focus-ring w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      {state.error && (
        <p className="rounded-md bg-dangerSoft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}
      <SubmitButton />
    </form>
  );
}

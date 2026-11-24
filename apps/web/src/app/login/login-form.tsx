'use client';

import { useActionState } from 'react';
import { buttonClass, inputClass } from '@/components/ui';
import { login } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: null });
  return (
    <form action={action} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
        Email
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass} w-full py-2`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

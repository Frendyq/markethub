import { useState, type FormEvent } from 'react';
import { Button, Field, Notice, inputClass } from '../components/ui';
import { api, errorMessage, isAppError, type User } from '../lib/tauri';

export function Login({ serverUrl, onSignedIn, onOpenSettings }: { serverUrl: string; onSignedIn: (user: User) => void; onOpenSettings: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(email, password));
    } catch (failure) {
      setError(isAppError(failure) && failure.kind === 'offline' ? `The server ${serverUrl} is not reachable.` : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-xl font-bold text-white">W</div>
          <h1 className="text-xl font-semibold">MarketHub Warehouse</h1>
          <p className="mt-1 text-sm text-zinc-500">Picking, shipping, receiving and stock counts</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy} className="w-full py-3">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Server: <span className="font-mono">{serverUrl}</span>{' '}
          <button type="button" onClick={onOpenSettings} className="underline hover:text-zinc-800">
            change
          </button>
        </p>
      </div>
    </main>
  );
}

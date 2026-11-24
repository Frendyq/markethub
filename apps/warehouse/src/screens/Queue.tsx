import { useCallback, useEffect, useState } from 'react';
import { Button, ConfirmButton, Notice, PageTitle } from '../components/ui';
import { api, errorMessage, type OutboxItem, type SyncStatus } from '../lib/tauri';

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function Queue({ status }: { status: SyncStatus | null }) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.outbox().then(setItems, (failure) => setError(errorMessage(failure)));
  }, []);

  // Reload whenever the background sync reports progress.
  useEffect(load, [load, status]);

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      load();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <>
      <PageTitle
        title="Sync queue"
        subtitle="Operations done on this computer that the server hasn't confirmed yet. Each one is sent once, even if the connection drops."
        actions={
          <Button variant="secondary" onClick={() => void act(api.syncNow)}>
            Send now
          </Button>
        }
      />
      <div className="mb-4 space-y-3">
        {status && !status.online && <Notice tone="warning">No connection. Operations wait here and are sent automatically.</Notice>}
        {status && !status.signedIn && <Notice tone="warning">Signed out: sign in again to send the queue.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-zinc-500">Everything is sent.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className={`rounded-xl border bg-white p-4 shadow-sm ${item.status === 'conflict' ? 'border-red-300' : 'border-zinc-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900">{item.label}</p>
                  <p className="text-xs text-zinc-500">
                    queued {time(item.createdAt)}
                    {item.attempts > 0 && ` · ${item.attempts} ${item.attempts === 1 ? 'attempt' : 'attempts'}`}
                    {item.status === 'pending' && item.attempts > 0 && ` · next try ${time(item.nextAttemptAt)}`}
                  </p>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${item.status === 'conflict' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                  {item.status === 'conflict' ? 'refused by the server' : 'waiting'}
                </span>
              </div>
              {item.lastError && <p className={`mt-2 text-sm ${item.status === 'conflict' ? 'text-red-700' : 'text-zinc-500'}`}>{item.lastError}</p>}
              {item.status === 'conflict' && (
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" onClick={() => void act(() => api.retryOperation(item.id))}>
                    Try again
                  </Button>
                  <ConfirmButton label="Discard" question="Drop this operation for good?" onConfirm={() => void act(() => api.discardOperation(item.id))} variant="ghost" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

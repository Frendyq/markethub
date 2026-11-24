import { useCallback, useEffect, useState } from 'react';
import { api, onSyncStatus, type AppInfo, type SyncStatus } from './lib/tauri';
import { Login } from './screens/Login';
import { OrderPick } from './screens/OrderPick';
import { PickingList } from './screens/PickingList';
import { Queue } from './screens/Queue';
import { Receiving } from './screens/Receiving';
import { Settings } from './screens/Settings';
import { StockCount } from './screens/StockCount';

type Screen = { name: 'picking' } | { name: 'order'; orderId: number } | { name: 'receiving' } | { name: 'count' } | { name: 'queue' } | { name: 'settings' };

const NAV: { name: Screen['name']; label: string }[] = [
  { name: 'picking', label: 'Picking' },
  { name: 'receiving', label: 'Receiving' },
  { name: 'count', label: 'Stock count' },
  { name: 'queue', label: 'Sync queue' },
  { name: 'settings', label: 'Settings' },
];

function SyncBadge({ status, onClick }: { status: SyncStatus | null; onClick: () => void }) {
  if (!status) return null;
  const tone = status.conflicts > 0 ? 'bg-red-500' : !status.online ? 'bg-amber-400' : status.pending > 0 ? 'bg-sky-400' : 'bg-emerald-500';
  const text =
    status.conflicts > 0
      ? `${status.conflicts} refused`
      : !status.online
        ? `Offline${status.pending ? ` · ${status.pending} waiting` : ''}`
        : status.pending > 0
          ? `Sending ${status.pending}…`
          : 'All sent';
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-800" title="Sync queue">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
      <span className="truncate">{text}</span>
    </button>
  );
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'picking' });
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [shipped, setShipped] = useState<string | null>(null);

  const refreshInfo = useCallback(() => {
    void api.appInfo().then(setInfo);
  }, []);

  useEffect(() => {
    refreshInfo();
    void api.syncStatus().then(setStatus);
    const unlisten = onSyncStatus(setStatus);
    // Events come from the sync loop; a poll also catches "offline" noticed by other commands.
    const timer = setInterval(() => void api.syncStatus().then(setStatus), 4_000);
    return () => {
      clearInterval(timer);
      void unlisten.then((stop) => stop());
    };
  }, [refreshInfo]);

  if (!info) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-500">Starting…</div>;
  }

  if (!info.signedIn) {
    return screen.name === 'settings' ? (
      <div className="min-h-screen bg-zinc-100 p-8">
        <button type="button" className="mb-4 text-sm text-zinc-500 hover:text-zinc-900" onClick={() => setScreen({ name: 'picking' })}>
          ← Sign in
        </button>
        <Settings info={info} onChanged={refreshInfo} />
      </div>
    ) : (
      <Login serverUrl={info.serverUrl} onSignedIn={refreshInfo} onOpenSettings={() => setScreen({ name: 'settings' })} />
    );
  }

  const signOut = async () => {
    await api.logout();
    setScreen({ name: 'picking' });
    refreshInfo();
  };

  const active = screen.name === 'order' ? 'picking' : screen.name;

  return (
    <div className="flex min-h-screen bg-zinc-100 text-zinc-900">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-zinc-900 px-3 py-5 text-zinc-300">
        <div className="mb-8 flex items-center gap-2 px-2 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-sm font-bold text-zinc-900">W</span>
          <span className="font-semibold">Warehouse</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => {
                setShipped(null);
                setScreen({ name: item.name } as Screen);
              }}
              className={`rounded-lg px-3 py-2.5 text-left text-sm ${active === item.name ? 'bg-zinc-800 font-semibold text-white' : 'hover:bg-zinc-800 hover:text-white'}`}
            >
              {item.label}
              {item.name === 'queue' && status && status.pending + status.conflicts > 0 && (
                <span className="ml-2 rounded-full bg-zinc-700 px-2 py-0.5 text-xs">{status.pending + status.conflicts}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t border-zinc-800 pt-3">
          <SyncBadge status={status} onClick={() => setScreen({ name: 'queue' })} />
          <p className="truncate px-3 text-xs text-zinc-500">{info.email}</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-8">
        {screen.name === 'picking' && <PickingList onOpen={(orderId) => setScreen({ name: 'order', orderId })} shippedMessage={shipped} />}
        {screen.name === 'order' && (
          <OrderPick
            orderId={screen.orderId}
            onBack={() => setScreen({ name: 'picking' })}
            onShipped={(orderNumber, queued) => {
              setShipped(queued ? `${orderNumber}: shipped here. It reaches the server as soon as the connection allows (see Sync queue).` : `${orderNumber}: shipped.`);
              setScreen({ name: 'picking' });
            }}
          />
        )}
        {screen.name === 'receiving' && <Receiving />}
        {screen.name === 'count' && <StockCount />}
        {screen.name === 'queue' && <Queue status={status} />}
        {screen.name === 'settings' && <Settings info={info} onChanged={refreshInfo} onSignOut={() => void signOut()} />}
      </main>
    </div>
  );
}

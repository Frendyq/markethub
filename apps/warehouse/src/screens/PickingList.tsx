import { useCallback, useEffect, useState } from 'react';
import { Button, Notice, PageTitle } from '../components/ui';
import { MARKETPLACES, api, errorMessage, type Order } from '../lib/tauri';

function age(placedAt: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(placedAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function PickingList({ onOpen, shippedMessage }: { onOpen: (orderId: number) => void; shippedMessage: string | null }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const view = await api.pickingList();
      setOrders(view.orders);
      setOffline(view.offline);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <>
      <PageTitle
        title="Orders to pick"
        subtitle="Stock is reserved for these orders. Oldest first."
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />
      <div className="mb-4 space-y-3">
        {shippedMessage && <Notice tone="success">{shippedMessage}</Notice>}
        {offline && <Notice tone="warning">No connection: this is the list saved on this computer. Shipping still works, it is sent when the connection is back.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      {orders && orders.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-zinc-500">Nothing to pick right now.</div>
      )}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {orders?.map((order) => (
          <li key={order.id}>
            <button
              type="button"
              onClick={() => onOpen(order.id)}
              className="w-full rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-zinc-400 hover:shadow"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">{MARKETPLACES[order.marketplace] ?? order.marketplace}</span>
                <span className="text-xs text-zinc-500">{age(order.placedAt)}</span>
              </div>
              <p className="mt-3 font-mono text-sm font-semibold">{order.externalId}</p>
              <p className="text-sm text-zinc-500">{order.customerName ?? '—'}</p>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span>
                  {order.lines.length} {order.lines.length === 1 ? 'line' : 'lines'}, {order.units} pcs
                </span>
                {order.scannedUnits > 0 && (
                  <span className={order.complete ? 'font-semibold text-emerald-700' : 'text-amber-700'}>
                    {order.complete ? 'picked' : `${order.scannedUnits}/${order.units} scanned`}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

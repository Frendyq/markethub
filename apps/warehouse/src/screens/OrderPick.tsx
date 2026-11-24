import { useEffect, useState } from 'react';
import { ScanInput } from '../components/ScanInput';
import { Button, Card, ConfirmButton, Notice, PageTitle } from '../components/ui';
import { beep } from '../lib/sound';
import { MARKETPLACES, api, errorMessage, type Order, type ScanOutcome } from '../lib/tauri';

type Feedback = { tone: 'success' | 'warning' | 'error'; text: string } | null;

function feedbackFor(outcome: ScanOutcome, complete: boolean): Feedback {
  switch (outcome.result) {
    case 'matched':
      return { tone: 'success', text: complete ? 'All items picked. Print the label and ship.' : `${outcome.title}: ${outcome.scanned} of ${outcome.needed}` };
    case 'alreadyComplete':
      return { tone: 'warning', text: `${outcome.title}: already have enough. Put this one back.` };
    case 'notInOrder':
      return { tone: 'error', text: 'This item is not in the order. Check the shelf.' };
    case 'invalidCode':
      return { tone: 'error', text: 'Could not read the barcode. Scan again.' };
  }
}

export function OrderPick({ orderId, onBack, onShipped }: { orderId: number; onBack: () => void; onShipped: (orderNumber: string, queued: boolean) => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    api.pickingOrder(orderId).then(setOrder, (failure) => setError(errorMessage(failure)));
  }, [orderId]);

  const scan = async (code: string) => {
    try {
      const view = await api.scanCode(orderId, code);
      setOrder(view.order);
      const next = feedbackFor(view.outcome, view.order.complete);
      setFeedback(next);
      beep(next?.tone === 'error' ? 'error' : view.order.complete ? 'done' : next?.tone === 'warning' ? 'error' : 'ok');
    } catch (failure) {
      beep('error');
      setFeedback({ tone: 'error', text: errorMessage(failure) });
    }
  };

  const reset = async () => {
    setOrder(await api.resetScans(orderId));
    setFeedback(null);
  };

  const printLabel = async () => {
    try {
      setLabel(await api.shippingLabel(orderId));
      // Let React put the label into the page before the print dialog opens.
      setTimeout(() => window.print(), 100);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const ship = async () => {
    if (!order) return;
    try {
      await api.shipOrder(orderId);
      // Give the background sync a moment: online, the shipment is usually confirmed within a second.
      await api.syncNow();
      let status = await api.syncStatus();
      for (let i = 0; i < 8 && status.pending > 0 && status.online; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = await api.syncStatus();
      }
      onShipped(order.externalId, status.pending > 0);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  if (error && !order) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{error}</Notice>
        <Button variant="secondary" onClick={onBack}>
          ← Back to the list
        </Button>
      </div>
    );
  }
  if (!order) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  return (
    <>
      <button type="button" onClick={onBack} className="mb-2 text-sm text-zinc-500 hover:text-zinc-900">
        ← Orders to pick
      </button>
      <PageTitle
        title={order.externalId}
        subtitle={`${MARKETPLACES[order.marketplace] ?? order.marketplace} · ${order.customerName ?? 'no name'} · ${order.scannedUnits} of ${order.units} pcs scanned`}
        actions={
          <>
            <Button variant="secondary" onClick={() => void printLabel()} disabled={!order.complete}>
              Print label
            </Button>
            <Button onClick={() => void ship()} disabled={!order.complete}>
              Ship
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <ScanInput onScan={(code) => void scan(code)} />
      </div>
      <div className="mb-6 min-h-12">
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <Card
        title="Pick list (walk order)"
        actions={order.scannedUnits > 0 && <ConfirmButton label="Start over" question="Forget the scans of this order?" onConfirm={() => void reset()} variant="ghost" />}
      >
        <table className="w-full text-left">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="pb-3 font-medium">Location</th>
              <th className="pb-3 font-medium">Item</th>
              <th className="pb-3 font-medium">Barcode</th>
              <th className="pb-3 text-right font-medium">Picked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {order.lines.map((line) => {
              const done = line.scanned >= line.quantity;
              return (
                <tr key={line.sku} className={done ? 'text-zinc-400' : ''}>
                  <td className="py-3 font-mono text-lg font-semibold">{line.location ?? '—'}</td>
                  <td className="py-3">
                    <p className={`font-medium ${done ? 'line-through' : 'text-zinc-900'}`}>{line.title}</p>
                    <p className="font-mono text-xs text-zinc-500">{line.sku}</p>
                  </td>
                  <td className="py-3 font-mono text-sm">{line.ean ?? <span className="text-xs text-zinc-400">type the SKU</span>}</td>
                  <td className="py-3 text-right">
                    <span className={`inline-flex min-w-16 justify-center rounded-lg px-3 py-1 text-lg font-semibold tabular-nums ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-900'}`}>
                      {line.scanned}/{line.quantity}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Printed on its own: see @media print in styles.css. The SVG comes from Rust (escaped there). */}
      {label && <div id="print-label" className="hidden print:block" dangerouslySetInnerHTML={{ __html: label }} />}
    </>
  );
}

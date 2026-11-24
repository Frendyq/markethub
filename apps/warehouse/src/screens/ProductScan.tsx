import { useState } from 'react';
import { ScanInput } from '../components/ScanInput';
import { Card, Notice } from '../components/ui';
import { beep } from '../lib/sound';
import { api, errorMessage, isAppError, type Product } from '../lib/tauri';

/** Step one of receiving and stock counts: scan the box, see what it is and how many we have. */
export function useProductScan() {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      setProduct(await api.findProduct(code));
      beep('ok');
    } catch (failure) {
      beep('error');
      setProduct(null);
      setError(
        isAppError(failure) && failure.kind === 'offline'
          ? 'No connection: looking up a product needs the server, the stock must be current.'
          : errorMessage(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  return { product, error, busy, scan, clear: () => setProduct(null) };
}

export function ProductCard({ product }: { product: Product }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-zinc-900">{product.title}</p>
          <p className="font-mono text-sm text-zinc-500">
            {product.sku} · {product.ean ?? 'no barcode'} · {product.category}
          </p>
        </div>
        <div className="rounded-lg bg-zinc-100 px-3 py-1 font-mono text-lg font-semibold">{product.location ?? 'no location'}</div>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-4 text-center">
        {(
          [
            ['On hand', product.stock.onHand],
            ['Reserved', product.stock.reserved],
            ['Available', product.stock.available],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function ProductScanStep({ state, placeholder }: { state: ReturnType<typeof useProductScan>; placeholder: string }) {
  return (
    <div className="space-y-4">
      <ScanInput onScan={(code) => void state.scan(code)} placeholder={placeholder} disabled={state.busy} autoFocus={!state.product} />
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
}

import { useState } from 'react';
import { Button, Field, Notice, PageTitle, inputClass } from '../components/ui';
import { api, errorMessage } from '../lib/tauri';
import { ProductCard, ProductScanStep, useProductScan } from './ProductScan';

export function StockCount() {
  const scan = useProductScan();
  const [counted, setCounted] = useState('');
  const [done, setDone] = useState<{ tone: 'success' | 'info'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const product = scan.product;
  const value = counted === '' ? null : Number(counted);
  const difference = product && value !== null && Number.isInteger(value) ? value - product.stock.onHand : null;

  const save = async () => {
    if (!product || value === null) return;
    try {
      const item = await api.countStock(product.id, product.sku, value, product.stock.onHand);
      setDone(item ? { tone: 'success', text: `${item.label}: queued.` } : { tone: 'info', text: `${product.sku}: matches the system, nothing to correct.` });
      setError(null);
      setCounted('');
      scan.clear();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <>
      <PageTitle title="Stock count" subtitle="Count what is on the shelf. The difference with the system becomes a correction." />
      <div className="max-w-2xl space-y-4">
        {done && <Notice tone={done.tone}>{done.text}</Notice>}
        <ProductScanStep state={scan} placeholder="Scan the product on the shelf" />
        {product && (
          <>
            <ProductCard product={product} />
            <Field label="Counted on the shelf" hint="Reserved units count too: they are still in the warehouse until shipped.">
              <input className={inputClass} type="number" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
            </Field>
            {difference !== null && (
              <p className={`text-sm font-medium ${difference === 0 ? 'text-zinc-600' : difference > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {difference === 0 ? 'Matches the system.' : `Difference: ${difference > 0 ? '+' : ''}${difference} pcs`}
              </p>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={difference === null}>
                Save count
              </Button>
              <Button variant="secondary" onClick={scan.clear}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

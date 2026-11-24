import { useState } from 'react';
import { Button, Field, Notice, PageTitle, inputClass } from '../components/ui';
import { api, errorMessage } from '../lib/tauri';
import { ProductCard, ProductScanStep, useProductScan } from './ProductScan';

export function Receiving() {
  const scan = useProductScan();
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receive = async () => {
    if (!scan.product) return;
    const amount = Number(quantity);
    try {
      const item = await api.receiveStock(scan.product.id, scan.product.sku, amount, note);
      setDone(`${item.label}: queued and sent as soon as possible.`);
      setError(null);
      setQuantity('1');
      setNote('');
      scan.clear();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <>
      <PageTitle title="Receiving" subtitle="Goods arrived: scan the box, enter how many came, confirm." />
      <div className="max-w-2xl space-y-4">
        {done && <Notice tone="success">{done}</Notice>}
        <ProductScanStep state={scan} placeholder="Scan the barcode on the box" />
        {scan.product && (
          <>
            <ProductCard product={scan.product} />
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <Field label="Quantity received">
                <input className={inputClass} type="number" min={1} max={10000} value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
              </Field>
              <Field label="Note" hint="Delivery note number, supplier…">
                <input className={inputClass} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex gap-2">
              <Button onClick={() => void receive()} disabled={!(Number(quantity) >= 1)}>
                Receive {Number(quantity) >= 1 ? `${quantity} ${Number(quantity) === 1 ? 'pc' : 'pcs'}` : ''}
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

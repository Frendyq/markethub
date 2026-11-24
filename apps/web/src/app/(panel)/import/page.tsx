import { Card, PageHeader } from '@/components/ui';
import { ImportForm } from './import-form';

export const metadata = { title: 'Price list import' };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Price list import"
        description="Upload a supplier CSV. The Rust pricing-engine checks every row; valid rows update the catalog and stock."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ImportForm />
        </div>
        <Card title="File format">
          <p className="text-sm text-zinc-600">Comma-separated, first row is the header:</p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-zinc-50 p-3 text-xs text-zinc-700">
            {`sku,title,category,cost_price,base_price,
weight_kg,width_cm,height_cm,depth_cm,ean,stock
SOF-OSLO-GRY,Oslo sofa,sofas,410,899.00,
54.5,210,85,95,4006381333931,4`}
          </pre>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            <li>Prices in EUR, a decimal comma is fine.</li>
            <li>
              <code>ean</code> and <code>stock</code> are optional. <code>stock</code> is a delivery: it is added to stock on hand.
            </li>
            <li>Up to 50 000 rows, 10 MB.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

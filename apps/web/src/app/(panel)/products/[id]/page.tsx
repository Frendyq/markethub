import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ActionButton, StockForm } from '@/components/forms';
import { Card, PageHeader, StatusBadge, Table, td } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, marketplaceName, money } from '@/lib/format';
import type { MarketplacePrice, Movement, Page, ProductDetail } from '@/lib/types';
import { addStockMovement, archiveProduct, listOnAllMarketplaces, publishListing } from '../../actions';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) {
    notFound();
  }

  let product: ProductDetail;
  try {
    product = await api<ProductDetail>(`/products/${productId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  const movements = await api<Page<Movement>>(`/inventory/${productId}/movements?limit=10`);

  return (
    <>
      <Link href="/products" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Products
      </Link>
      <PageHeader
        title={product.title}
        description={`${product.sku} · ${product.category}${product.ean ? ` · EAN ${product.ean}` : ''}${product.isActive ? '' : ' · archived'}`}
        actions={
          <>
            <ActionButton action={listOnAllMarketplaces.bind(null, product.id)} label="List on all marketplaces" variant="primary" />
            {product.isActive && (
              <ActionButton
                action={archiveProduct.bind(null, product.id)}
                label="Archive"
                confirm="Archive this product? It will be hidden on every marketplace."
              />
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Stock">
          <dl className="grid grid-cols-3 gap-4 text-center">
            {[
              ['On hand', product.stock.onHand],
              ['Reserved', product.stock.reserved],
              ['Available', product.stock.available],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <StockForm action={addStockMovement.bind(null, product.id)} />
          </div>
        </Card>

        <Card title="Catalog data">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-zinc-500">Net price</dt>
            <dd className="text-right font-medium tabular-nums">{money(product.basePrice)}</dd>
            <dt className="text-zinc-500">Cost</dt>
            <dd className="text-right tabular-nums">{money(product.costPrice)}</dd>
            <dt className="text-zinc-500">Weight</dt>
            <dd className="text-right tabular-nums">{product.weightKg} kg</dd>
            <dt className="text-zinc-500">Size (W×H×D)</dt>
            <dd className="text-right tabular-nums">
              {product.widthCm}×{product.heightCm}×{product.depthCm} cm
            </dd>
          </dl>
        </Card>

        <Card title="Price per marketplace (Rust pricing-engine)">
          <Suspense fallback={<p className="text-sm text-zinc-500">Calculating…</p>}>
            <Prices productId={product.id} />
          </Suspense>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-zinc-700">Listings</h2>
      <Table head={['Marketplace', 'Status', 'Price', 'Quantity', 'Last sync', 'Last error', '']} empty={product.listings.length === 0}>
        {product.listings.map((l) => (
          <tr key={l.id}>
            <td className={`${td} font-medium`}>{marketplaceName(l.marketplace)}</td>
            <td className={td}>
              <StatusBadge status={l.status} />
            </td>
            <td className={`${td} tabular-nums`}>{money(l.price, l.currency)}</td>
            <td className={`${td} tabular-nums`}>{l.quantity ?? '—'}</td>
            <td className={`${td} text-zinc-500`}>{dateTime(l.lastSyncedAt)}</td>
            <td className={`${td} max-w-xs truncate text-red-700`} title={l.lastError ?? ''}>
              {l.lastError ?? ''}
            </td>
            <td className={td}>
              <ActionButton action={publishListing.bind(null, l.id, product.id)} label={l.status === 'DRAFT' ? 'Publish' : 'Push now'} />
            </td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-zinc-700">Stock history</h2>
      <Table head={['When', 'Type', 'Change', 'Reason']} empty={movements.items.length === 0}>
        {movements.items.map((m) => (
          <tr key={m.id}>
            <td className={`${td} text-zinc-500`}>{dateTime(m.createdAt)}</td>
            <td className={td}>{m.type.toLowerCase()}</td>
            <td className={`${td} tabular-nums ${m.quantity < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
              {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
            </td>
            <td className={`${td} text-zinc-500`}>{m.reason ?? ''}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

async function Prices({ productId }: { productId: number }) {
  let prices: MarketplacePrice[];
  try {
    prices = await api<MarketplacePrice[]>(`/products/${productId}/prices`);
  } catch {
    return <p className="text-sm text-amber-700">The pricing-engine is not reachable right now.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-zinc-500">
        <tr>
          <th className="pb-2 text-left font-medium">Marketplace</th>
          <th className="pb-2 text-right font-medium">Price</th>
          <th className="pb-2 text-right font-medium">Margin</th>
        </tr>
      </thead>
      <tbody>
        {prices.map((p) => (
          <tr key={p.marketplace} title={`VAT ${p.vatAmount}, fee ${p.feeAmount}, you keep €${p.proceedsEur}`}>
            <td className="py-1">{marketplaceName(p.marketplace)}</td>
            <td className="py-1 text-right font-medium tabular-nums">{money(p.price, p.currency)}</td>
            <td className={`py-1 text-right tabular-nums ${p.belowMinMargin ? 'text-red-600' : 'text-zinc-600'}`}>{p.marginPercent}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

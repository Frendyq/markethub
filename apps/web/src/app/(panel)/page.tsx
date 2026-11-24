import Link from 'next/link';
import { Card, Stat, StatusBadge, Table, td } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, marketplaceName, money } from '@/lib/format';
import type { Dashboard, ListingStatus } from '@/lib/types';

export const metadata = { title: 'Overview' };

const LISTING_ORDER: ListingStatus[] = ['ACTIVE', 'PENDING', 'PAUSED', 'ERROR', 'DRAFT'];

export default async function OverviewPage() {
  const data = await api<Dashboard>('/dashboard');
  const revenue = data.orders.revenueToday.map((r) => money(r.amount, r.currency)).join(' + ') || '—';

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Today across Amazon, eBay, OTTO and Kaufland</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Orders today" value={data.orders.today} hint={`Revenue ${revenue}`} />
        <Stat label="Waiting to ship" value={data.orders.reserved} hint="Reserved orders" />
        <Stat label="Backordered" value={data.orders.backordered} tone={data.orders.backordered > 0 ? 'warn' : 'default'} hint="Not enough stock when ordered" />
        <Stat
          label="Low stock"
          value={data.products.lowStock + data.products.outOfStock}
          tone={data.products.outOfStock > 0 ? 'bad' : data.products.lowStock > 0 ? 'warn' : 'default'}
          hint={`${data.products.outOfStock} out of stock of ${data.products.active} active`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Listings" className="xl:col-span-1">
          <ul className="space-y-3">
            {LISTING_ORDER.map((status) => (
              <li key={status} className="flex items-center justify-between">
                <Link href={`/listings?status=${status}`} className="hover:underline">
                  <StatusBadge status={status} />
                </Link>
                <span className="font-semibold tabular-nums">{data.listings[status]}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Latest sync failures" className="xl:col-span-2">
          {data.recentFailures.length === 0 ? (
            <p className="text-sm text-zinc-500">No failed pushes. Retries handle temporary marketplace errors.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.recentFailures.map((f) => (
                <li key={f.id} className="flex gap-3">
                  <span className="w-28 shrink-0 text-zinc-500">{dateTime(f.createdAt)}</span>
                  <span className="w-20 shrink-0 font-medium">{marketplaceName(f.marketplace)}</span>
                  <span className="truncate text-red-700" title={f.error ?? ''}>
                    {f.sku ? `${f.sku}: ` : ''}
                    {f.error}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-zinc-700">Latest orders</h2>
      <Table head={['Order', 'Marketplace', 'Customer', 'Items', 'Total', 'Status', 'Placed']} empty={data.recentOrders.length === 0}>
        {data.recentOrders.map((order) => (
          <tr key={order.id} className="hover:bg-zinc-50">
            <td className={`${td} font-mono text-xs`}>{order.externalId}</td>
            <td className={td}>{marketplaceName(order.marketplace)}</td>
            <td className={td}>{order.customerName ?? '—'}</td>
            <td className={td}>{order.items.map((i) => `${i.quantity}× ${i.sku}`).join(', ')}</td>
            <td className={`${td} tabular-nums`}>{money(order.totalAmount, order.currency)}</td>
            <td className={td}>
              <StatusBadge status={order.status} />
            </td>
            <td className={`${td} text-zinc-500`}>{dateTime(order.placedAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

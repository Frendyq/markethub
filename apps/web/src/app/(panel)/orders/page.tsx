import Link from 'next/link';
import { ActionButton } from '@/components/forms';
import { PageHeader, Pagination, StatusBadge, Table, buttonClass, inputClass, td } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, marketplaceName, money } from '@/lib/format';
import type { Order, OrderStatus, Page } from '@/lib/types';
import { changeOrder } from '../actions';

export const metadata = { title: 'Orders' };

const STATUSES: OrderStatus[] = ['RESERVED', 'BACKORDERED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

type Search = { status?: string; search?: string; page?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ page: params.page ?? '1', limit: '20' });
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  const orders = await api<Page<Order>>(`/orders?${query}`);

  return (
    <>
      <PageHeader title="Orders" description="Orders from every marketplace. Stock is reserved when an order comes in." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/orders" className={`rounded-full px-3 py-1 text-sm ${!params.status ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 ring-1 ring-zinc-200'}`}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/orders?status=${s}`}
            className={`rounded-full px-3 py-1 text-sm ${params.status === s ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 ring-1 ring-zinc-200'}`}
          >
            {s.toLowerCase()}
          </Link>
        ))}
        <form className="ml-auto flex gap-2">
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <input name="search" defaultValue={params.search} placeholder="Order number or customer" className={`${inputClass} w-60`} />
          <button className={buttonClass}>Search</button>
        </form>
      </div>

      <Table head={['Order', 'Marketplace', 'Customer', 'Items', 'Total', 'Status', 'Placed', '']} empty={orders.items.length === 0}>
        {orders.items.map((order) => (
          <tr key={order.id} className="hover:bg-zinc-50">
            <td className={`${td} font-mono text-xs`}>{order.externalId}</td>
            <td className={td}>{marketplaceName(order.marketplace)}</td>
            <td className={td}>{order.customerName ?? '—'}</td>
            <td className={`${td} whitespace-normal`}>
              {order.items.map((i) => (
                <div key={i.id}>
                  {i.productId ? (
                    <Link href={`/products/${i.productId}`} className="hover:underline">
                      {i.quantity}× {i.sku}
                    </Link>
                  ) : (
                    <span className="text-orange-700" title="This SKU is not in the catalog">
                      {i.quantity}× {i.sku}
                    </span>
                  )}
                </div>
              ))}
            </td>
            <td className={`${td} tabular-nums`}>{money(order.totalAmount, order.currency)}</td>
            <td className={td}>
              <StatusBadge status={order.status} />
            </td>
            <td className={`${td} text-zinc-500`}>{dateTime(order.placedAt)}</td>
            <td className={`${td} space-x-2`}>
              {order.status === 'RESERVED' && <ActionButton action={changeOrder.bind(null, order.id, 'ship')} label="Ship" variant="primary" />}
              {order.status === 'SHIPPED' && <ActionButton action={changeOrder.bind(null, order.id, 'deliver')} label="Delivered" />}
              {(order.status === 'RESERVED' || order.status === 'BACKORDERED') && (
                <ActionButton action={changeOrder.bind(null, order.id, 'cancel')} label="Cancel" confirm="Cancel the order?" />
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Pagination page={orders.page} limit={orders.limit} total={orders.total} base="/orders" params={{ status: params.status, search: params.search }} />
    </>
  );
}

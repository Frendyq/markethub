import Link from 'next/link';
import { ActionButton, AutoRefresh } from '@/components/forms';
import { PageHeader, Pagination, StatusBadge, Table, td } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, marketplaceName, money } from '@/lib/format';
import type { Listing, ListingStatus, Marketplace, Page } from '@/lib/types';
import { publishListing } from '../actions';

export const metadata = { title: 'Listings' };

const STATUSES: ListingStatus[] = ['ACTIVE', 'PENDING', 'PAUSED', 'ERROR', 'DRAFT'];

type Search = { status?: string; marketplaceId?: string; page?: string };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ page: params.page ?? '1', limit: '25' });
  if (params.status) query.set('status', params.status);
  if (params.marketplaceId) query.set('marketplaceId', params.marketplaceId);
  const [listings, marketplaces] = await Promise.all([api<Page<Listing>>(`/listings?${query}`), api<Marketplace[]>('/marketplaces')]);

  const link = (patch: Partial<Search>) => {
    const next = new URLSearchParams(
      Object.entries({ status: params.status, marketplaceId: params.marketplaceId, ...patch }).filter((e): e is [string, string] => !!e[1]),
    );
    return `/listings?${next}`;
  };
  const pill = (active: boolean) => `rounded-full px-3 py-1 text-sm ${active ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 ring-1 ring-zinc-200'}`;

  return (
    <>
      <PageHeader title="Listings" description="What each marketplace shows. Pushed by the queue worker with retries and rate limits." />

      {listings.items.some((l) => l.status === 'PENDING') && <AutoRefresh />}
      <div className="mb-3 flex flex-wrap gap-2">
        <Link href={link({ marketplaceId: undefined })} className={pill(!params.marketplaceId)}>
          All marketplaces
        </Link>
        {marketplaces.map((m) => (
          <Link key={m.id} href={link({ marketplaceId: String(m.id) })} className={pill(params.marketplaceId === String(m.id))}>
            {m.name} {!m.isEnabled && '(off)'}
          </Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={link({ status: undefined })} className={pill(!params.status)}>
          Any status
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={link({ status: s })} className={pill(params.status === s)}>
            {s.toLowerCase()}
          </Link>
        ))}
      </div>

      <Table head={['Product', 'Marketplace', 'Status', 'Price', 'Qty', 'External id', 'Last sync', 'Error', '']} empty={listings.items.length === 0} emptyText="No listings match these filters.">
        {listings.items.map((l) => (
          <tr key={l.id} className="hover:bg-zinc-50">
            <td className={td}>
              <Link href={`/products/${l.productId}`} className="font-medium hover:underline">
                {l.title}
              </Link>
              <div className="font-mono text-xs text-zinc-500">{l.sku}</div>
            </td>
            <td className={td}>{marketplaceName(l.marketplace)}</td>
            <td className={td}>
              <StatusBadge status={l.status} />
            </td>
            <td className={`${td} tabular-nums`}>{money(l.price, l.currency)}</td>
            <td className={`${td} tabular-nums`}>{l.quantity ?? '—'}</td>
            <td className={`${td} font-mono text-xs text-zinc-500`}>{l.externalId ?? '—'}</td>
            <td className={`${td} text-zinc-500`}>{dateTime(l.lastSyncedAt)}</td>
            <td className={`${td} max-w-xs truncate text-red-700`} title={l.lastError ?? ''}>
              {l.lastError ?? ''}
            </td>
            <td className={td}>
              <ActionButton action={publishListing.bind(null, l.id, undefined)} label={l.status === 'DRAFT' ? 'Publish' : l.status === 'ERROR' ? 'Retry' : 'Push'} />
            </td>
          </tr>
        ))}
      </Table>
      <Pagination page={listings.page} limit={listings.limit} total={listings.total} base="/listings" params={{ status: params.status, marketplaceId: params.marketplaceId }} />
    </>
  );
}

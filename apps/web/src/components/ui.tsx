import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ListingStatus, OrderStatus } from '@/lib/types';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>
      {title && <h2 className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-700">{title}</h2>}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-zinc-900';
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

const STATUS_STYLE: Record<ListingStatus | OrderStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  DELIVERED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  RESERVED: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  SHIPPED: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  PAUSED: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20',
  DRAFT: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20',
  CANCELLED: 'bg-zinc-100 text-zinc-500 ring-zinc-500/20',
  BACKORDERED: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  ERROR: 'bg-red-50 text-red-700 ring-red-600/20',
};

export function StatusBadge({ status }: { status: ListingStatus | OrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="whitespace-nowrap px-4 py-3 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-10 text-center text-zinc-500">
                Nothing here yet.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export const td = 'whitespace-nowrap px-4 py-3 align-middle';

/** Page links that keep the current filters. */
export function Pagination({ page, limit, total, base, params }: { page: number; limit: number; total: number; base: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const href = (p: number) => {
    const query = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => !!e[1]));
    return `${base}?${query}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
      <span>
        {total} total · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 hover:bg-zinc-50" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pages && (
          <Link className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 hover:bg-zinc-50" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

export const inputClass =
  'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200';
export const buttonClass =
  'inline-flex items-center justify-center rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50';

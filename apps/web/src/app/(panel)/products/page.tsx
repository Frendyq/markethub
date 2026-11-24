import Link from 'next/link';
import { PageHeader, Pagination, Table, buttonClass, inputClass, td } from '@/components/ui';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { Page, Product } from '@/lib/types';

export const metadata = { title: 'Products' };

type Search = { search?: string; category?: string; lowStock?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ page: params.page ?? '1', limit: '20' });
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.lowStock) query.set('lowStock', params.lowStock);

  const [products, categories] = await Promise.all([
    api<Page<Product>>(`/products?${query}`),
    api<string[]>('/products/categories'),
  ]);

  return (
    <>
      <PageHeader title="Products" description="One catalog for every marketplace. Prices are net, in EUR." />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <input name="search" defaultValue={params.search} placeholder="Search title or SKU" className={`${inputClass} w-64`} />
        <select name="category" defaultValue={params.category ?? ''} className={inputClass}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input type="checkbox" name="lowStock" value="2" defaultChecked={!!params.lowStock} /> Low stock only
        </label>
        <button className={buttonClass}>Filter</button>
      </form>

      <Table head={['SKU', 'Title', 'Category', 'Cost', 'Price', 'On hand', 'Reserved', 'Available', '']} empty={products.items.length === 0}>
        {products.items.map((p) => (
          <tr key={p.id} className={`hover:bg-zinc-50 ${p.isActive ? '' : 'opacity-50'}`}>
            <td className={`${td} font-mono text-xs`}>{p.sku}</td>
            <td className={td}>
              <Link href={`/products/${p.id}`} className="font-medium text-zinc-900 hover:underline">
                {p.title}
              </Link>
              {!p.isActive && <span className="ml-2 text-xs text-zinc-500">archived</span>}
            </td>
            <td className={`${td} text-zinc-500`}>{p.category}</td>
            <td className={`${td} tabular-nums text-zinc-500`}>{money(p.costPrice)}</td>
            <td className={`${td} tabular-nums`}>{money(p.basePrice)}</td>
            <td className={`${td} tabular-nums`}>{p.stock.onHand}</td>
            <td className={`${td} tabular-nums`}>{p.stock.reserved}</td>
            <td className={`${td} tabular-nums font-semibold ${p.stock.available <= 0 ? 'text-red-600' : p.stock.available <= 2 ? 'text-amber-600' : ''}`}>
              {p.stock.available}
            </td>
            <td className={td}>
              <Link href={`/products/${p.id}`} className="text-sm text-zinc-500 hover:text-zinc-900">
                Open →
              </Link>
            </td>
          </tr>
        ))}
      </Table>
      <Pagination page={products.page} limit={products.limit} total={products.total} base="/products" params={{ search: params.search, category: params.category, lowStock: params.lowStock }} />
    </>
  );
}

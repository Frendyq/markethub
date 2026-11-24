import Link from 'next/link';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { logout } from '../login/actions';
import { NavLinks } from './nav-links';

const QUEUES_URL = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/admin/queues`;

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await api<User>('/auth/me');
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-zinc-900 px-4 py-6 text-zinc-300">
        <Link href="/" className="mb-8 flex items-center gap-2 px-2 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-sm font-bold text-zinc-900">M</span>
          <span className="text-lg font-semibold">MarketHub</span>
        </Link>
        <NavLinks />
        <a href={QUEUES_URL} target="_blank" rel="noreferrer" className="mt-2 rounded-md px-3 py-2 text-sm hover:bg-zinc-800 hover:text-white">
          Queues ↗
        </a>
        <div className="mt-auto border-t border-zinc-800 pt-4 text-xs">
          <p className="truncate text-zinc-400">{user.email}</p>
          <p className="mb-3 text-zinc-500">{user.role.toLowerCase()}</p>
          <form action={logout}>
            <button className="text-zinc-400 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}

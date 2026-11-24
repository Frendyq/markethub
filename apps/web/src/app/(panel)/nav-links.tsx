'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/products', label: 'Products' },
  { href: '/listings', label: 'Listings' },
  { href: '/orders', label: 'Orders' },
  { href: '/import', label: 'Price list import' },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map((link) => {
        const active = link.href === '/' ? path === '/' : path.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-2 text-sm ${active ? 'bg-zinc-800 font-medium text-white' : 'hover:bg-zinc-800 hover:text-white'}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

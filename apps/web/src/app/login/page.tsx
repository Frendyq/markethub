import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { REFRESH_COOKIE } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  // Already signed in: go straight to the panel (proxy.ts refreshes the access token if needed).
  if ((await cookies()).get(REFRESH_COOKIE)) {
    redirect('/');
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-lg font-bold text-white">M</div>
          <h1 className="text-xl font-semibold">MarketHub</h1>
          <p className="mt-1 text-sm text-zinc-500">Catalog, stock and orders on every marketplace</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-zinc-400">Demo: admin@markethub.local / admin12345</p>
      </div>
    </main>
  );
}

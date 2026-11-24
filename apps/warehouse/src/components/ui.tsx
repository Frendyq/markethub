import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Big targets and big type: the app is used standing at a packing table, often with gloves.

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-zinc-900 text-white hover:bg-zinc-700',
  secondary: 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'text-zinc-600 hover:bg-zinc-100',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** First click asks, second click does it. No blocking browser dialogs. */
export function ConfirmButton({ label, question, onConfirm, variant = 'secondary' }: { label: string; question: string; onConfirm: () => void; variant?: Variant }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant={variant} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-sm text-zinc-600">{question}</span>
      <Button
        variant="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Yes
      </Button>
      <Button variant="secondary" onClick={() => setAsking(false)}>
        No
      </Button>
    </span>
  );
}

export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-700">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'success' | 'warning' | 'error'; children: ReactNode }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
    </label>
  );
}

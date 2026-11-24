'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass, inputClass, secondaryButtonClass } from './ui';

export type ActionState = { error: string | null; message?: string | null };

function Submit({ label, pendingLabel, variant }: { label: string; pendingLabel?: string; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={variant === 'primary' ? buttonClass : secondaryButtonClass}>
      {pending ? (pendingLabel ?? `${label}…`) : label}
    </button>
  );
}

/**
 * One button that runs a server action and shows the API error next to it, if any.
 * With `confirm`, the first click asks inline ("Cancel order? Yes / No") instead of a blocking browser dialog.
 */
export function ActionButton({
  action,
  label,
  variant = 'secondary',
  confirm,
}: {
  action: () => Promise<ActionState>;
  label: string;
  variant?: 'primary' | 'secondary';
  confirm?: string;
}) {
  const [state, run] = useActionState(async () => action(), { error: null });
  const [asking, setAsking] = useState(false);

  if (confirm && !asking) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" onClick={() => setAsking(true)} className={variant === 'primary' ? buttonClass : secondaryButtonClass}>
          {label}
        </button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </span>
    );
  }

  return (
    <form action={run} onSubmit={() => setAsking(false)} className="inline-flex items-center gap-2">
      {confirm && <span className="text-xs text-zinc-600">{confirm}</span>}
      <Submit label={confirm ? 'Yes' : label} variant={confirm ? 'primary' : variant} />
      {confirm && (
        <button type="button" onClick={() => setAsking(false)} className={secondaryButtonClass}>
          No
        </button>
      )}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Receipt or correction of stock on the product page. */
export function StockForm({ action }: { action: (state: ActionState, data: FormData) => Promise<ActionState> }) {
  const [state, run] = useActionState(action, { error: null });
  return (
    <form action={run} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
        Type
        <select name="type" className={inputClass} defaultValue="RECEIPT">
          <option value="RECEIPT">Receipt</option>
          <option value="ADJUSTMENT">Correction</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
        Quantity
        <input name="quantity" type="number" required className={`${inputClass} w-28`} placeholder="+5 or -2" />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-zinc-600">
        Reason
        <input name="reason" className={inputClass} placeholder="Delivery, stock count…" />
      </label>
      <Submit label="Save" variant="primary" />
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="w-full text-sm text-emerald-700">{state.message}</p>}
    </form>
  );
}

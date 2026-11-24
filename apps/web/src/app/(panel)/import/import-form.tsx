'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { Card, buttonClass, secondaryButtonClass } from '@/components/ui';
import { importPriceList, type ImportState } from './actions';

export function ImportForm() {
  const [state, action, pending] = useActionState(importPriceList, { error: null, result: null } as ImportState);
  const result = state.result;

  // Submitted by hand instead of <form action>: React resets a form after its action, which would
  // clear the chosen file and make "Check only" then "Import" ask for the file twice.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => action(data));
  };

  return (
    <Card title="Upload">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-zinc-200"
        />
        <button name="mode" value="check" disabled={pending} className={secondaryButtonClass}>
          Check only
        </button>
        <button name="mode" value="import" disabled={pending} className={buttonClass}>
          {pending ? 'Working…' : 'Import'}
        </button>
      </form>

      {state.error && <p className="mt-4 text-sm text-red-600">{state.error}</p>}

      {result && (
        <div className="mt-6">
          <p className="text-sm">
            {result.dryRun ? 'Checked' : 'Imported'}: <b>{result.totalRows}</b> rows, <b className="text-emerald-700">{result.validRows}</b> valid,{' '}
            <b className={result.errorRows ? 'text-red-600' : ''}>{result.errorRows}</b> with errors.
            {!result.dryRun && (
              <>
                {' '}
                {plural(result.created, 'new product')}, {result.updated} updated.
              </>
            )}
          </p>
          {result.errors.length > 0 && (
            <div className="mt-4 max-h-96 overflow-auto rounded-md border border-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {result.errors.map((e, index) => (
                    <tr key={index}>
                      <td className="px-3 py-1.5 tabular-nums">{e.line}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{e.sku ?? '—'}</td>
                      <td className="px-3 py-1.5">{e.field}</td>
                      <td className="px-3 py-1.5 text-red-700">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

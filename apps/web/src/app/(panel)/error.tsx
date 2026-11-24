'use client';

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{error.message || 'The API returned an error.'}</p>
      <button onClick={reset} className="mt-4 rounded-md bg-red-700 px-3 py-1.5 text-white hover:bg-red-600">
        Try again
      </button>
    </div>
  );
}

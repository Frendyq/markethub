'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { ImportResult } from '@/lib/types';

export type ImportState = { error: string | null; result: ImportResult | null };

const MAX_BYTES = 10 * 1024 * 1024;

export async function importPriceList(_: ImportState, form: FormData): Promise<ImportState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file', result: null };
  }
  if (file.size > MAX_BYTES) {
    return { error: 'The file is larger than 10 MB', result: null };
  }
  const dryRun = form.get('mode') !== 'import';
  try {
    const result = await api<ImportResult>(`/feeds/import?dryRun=${dryRun}`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: await file.text(),
    });
    if (!dryRun) {
      revalidatePath('/products');
    }
    return { error: null, result };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message, result: null };
    }
    throw error;
  }
}

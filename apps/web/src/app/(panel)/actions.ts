'use server';

import { revalidatePath } from 'next/cache';
import { api, attempt } from '@/lib/api';
import type { ActionState } from '@/components/forms';

// Every action authorizes itself: api() sends the signed-in user's token and the API checks it.

export async function addStockMovement(productId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const quantity = Number(form.get('quantity'));
  if (!Number.isInteger(quantity) || quantity === 0) {
    return { error: 'Quantity must be a whole number other than 0' };
  }
  const body = { type: String(form.get('type')), quantity, reason: String(form.get('reason') ?? '') || undefined };
  const result = await attempt(() => api(`/inventory/${productId}/movements`, { method: 'POST', body: JSON.stringify(body) }));
  if (!result.error) {
    revalidatePath(`/products/${productId}`);
    return { error: null, message: 'Saved. Marketplaces will get the new quantity in a moment.' };
  }
  return result;
}

export async function listOnAllMarketplaces(productId: number): Promise<ActionState> {
  const result = await attempt(() => api('/listings', { method: 'POST', body: JSON.stringify({ productId, publish: true }) }));
  revalidatePath(`/products/${productId}`);
  return result;
}

export async function publishListing(listingId: number, productId?: number): Promise<ActionState> {
  const result = await attempt(() => api(`/listings/${listingId}/publish`, { method: 'POST' }));
  revalidatePath(productId ? `/products/${productId}` : '/listings');
  return result;
}

export async function archiveProduct(productId: number): Promise<ActionState> {
  const result = await attempt(() => api(`/products/${productId}`, { method: 'DELETE' }));
  revalidatePath(`/products/${productId}`);
  return result;
}

export async function changeOrder(orderId: number, step: 'ship' | 'deliver' | 'cancel'): Promise<ActionState> {
  const result = await attempt(() => api(`/orders/${orderId}/${step}`, { method: 'POST' }));
  revalidatePath('/orders');
  return result;
}

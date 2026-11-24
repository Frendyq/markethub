import { randomUUID } from 'node:crypto';
import type { MarketplaceCode } from './config.js';

export interface StoredListing {
  sku: string;
  externalId: string;
  title: string;
  /** Price in minor units (cents) to avoid floats. */
  priceCents: number;
  currency: string;
  quantity: number;
  updatedAt: string;
}

/** Marketplace-neutral order; formats.ts renders it the way each marketplace would. */
export interface StoredOrder {
  id: string;
  marketplace: MarketplaceCode;
  createdAt: string;
  buyerName: string;
  currency: string;
  items: { sku: string; quantity: number; unitPriceCents: number }[];
}

const listings = new Map<MarketplaceCode, Map<string, StoredListing>>();
const orders: StoredOrder[] = [];
let requests = 0;

export const store = {
  countRequest(): void {
    requests += 1;
  },

  upsertListing(marketplace: MarketplaceCode, input: Omit<StoredListing, 'externalId' | 'updatedAt'>): StoredListing {
    const bucket = listings.get(marketplace) ?? new Map<string, StoredListing>();
    listings.set(marketplace, bucket);
    const existing = bucket.get(input.sku);
    const listing: StoredListing = {
      ...input,
      externalId: existing?.externalId ?? `${marketplace.slice(0, 3).toUpperCase()}-${randomUUID().slice(0, 8)}`,
      updatedAt: new Date().toISOString(),
    };
    bucket.set(input.sku, listing);
    return listing;
  },

  listings(marketplace: MarketplaceCode): StoredListing[] {
    return [...(listings.get(marketplace)?.values() ?? [])];
  },

  addOrder(order: StoredOrder): void {
    orders.push(order);
  },

  ordersSince(marketplace: MarketplaceCode, since: Date): StoredOrder[] {
    return orders.filter((o) => o.marketplace === marketplace && new Date(o.createdAt) >= since);
  },

  state() {
    return {
      requests,
      listings: Object.fromEntries([...listings.entries()].map(([code, bucket]) => [code, [...bucket.values()]])),
      orders,
    };
  },

  reset(): void {
    listings.clear();
    orders.length = 0;
    requests = 0;
  },
};

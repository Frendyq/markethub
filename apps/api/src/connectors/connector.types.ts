/** What MarketHub sends to any marketplace for one listing. */
export interface ListingPush {
  sku: string;
  title: string;
  ean: string | null;
  /** Price the buyer pays, as a decimal string in the marketplace currency ("1283.99"). */
  price: string;
  currency: string;
  /** Units available for sale. 0 hides the offer. */
  quantity: number;
}

/** An order translated from any marketplace format into ours. */
export interface ExternalOrder {
  externalId: string;
  placedAt: Date;
  currency: string;
  /** Decimal string. */
  total: string;
  customerName: string | null;
  items: { sku: string; quantity: number; unitPrice: string }[];
}

/**
 * One implementation per marketplace. Adding a marketplace means adding a connector;
 * queues, orders and stock code don't change.
 */
export interface MarketplaceConnector {
  readonly code: string;
  pushListing(listing: ListingPush): Promise<{ externalId: string }>;
  fetchOrders(since: Date): Promise<ExternalOrder[]>;
  /** The "order" object of a webhook body, in this marketplace's format. */
  parseOrder(raw: unknown): ExternalOrder;
}

/** The marketplace asked us to slow down (HTTP 429). Retry after the given delay. */
export class RateLimitedError extends Error {
  constructor(
    readonly marketplace: string,
    readonly retryAfterMs: number,
  ) {
    super(`${marketplace}: rate limited, retry in ${retryAfterMs} ms`);
  }
}

/** Timeout, network error or 5xx: worth retrying. */
export class TransientMarketplaceError extends Error {}

/** 4xx other than 429, or a response we can't understand: retrying won't help. */
export class PermanentMarketplaceError extends Error {}

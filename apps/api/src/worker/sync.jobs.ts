import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ListingStatus, SyncStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingClient } from '../pricing/pricing.client.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  PermanentMarketplaceError,
  RateLimitedError,
  type ListingPush,
  type MarketplaceConnector,
} from '../connectors/connector.types.js';

export interface JobResult {
  status: SyncStatus;
  detail?: string;
}

/** What the queue should do with a failed job. */
export type FailureAction =
  | { kind: 'rate-limit'; delayMs: number } // pause the queue, put the job back, keep its attempts
  | { kind: 'give-up'; message: string } // retrying won't help
  | { kind: 'retry' }; // try again with backoff

export function classifyFailure(error: unknown): FailureAction {
  if (error instanceof RateLimitedError) {
    return { kind: 'rate-limit', delayMs: error.retryAfterMs };
  }
  if (error instanceof PermanentMarketplaceError) {
    return { kind: 'give-up', message: error.message };
  }
  return { kind: 'retry' };
}

const ORDER_PULL_OVERLAP_MS = 5 * 60_000;

/**
 * The work behind each queue job, without BullMQ: SyncWorkers runs these from the queues,
 * tests call them directly with a fake marketplace.
 */
@Injectable()
export class SyncJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingClient,
    private readonly orders: OrdersService,
  ) {}

  /** Sends the current price and stock of a listing to its marketplace. */
  async pushListing(listingId: number, connector: MarketplaceConnector): Promise<JobResult> {
    // Read the current state now, not when the job was queued.
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { marketplace: true, product: { include: { inventory: true } } },
    });
    if (!listing) {
      return { status: SyncStatus.SKIPPED, detail: 'listing no longer exists' };
    }
    if (!listing.marketplace.isEnabled) {
      return { status: SyncStatus.SKIPPED, detail: 'marketplace disabled' };
    }

    const { product } = listing;
    const available = product.isActive ? Math.max(0, (product.inventory?.onHand ?? 0) - (product.inventory?.reserved ?? 0)) : 0;
    const prices = await this.pricing.calculate(connector.code, [
      { sku: product.sku, basePrice: product.basePrice.toFixed(2), costPrice: product.costPrice.toFixed(2) },
    ]);
    const quote = prices.items[0];
    const push: ListingPush = {
      sku: product.sku,
      title: product.title,
      ean: product.ean,
      price: quote.price,
      currency: quote.currency,
      quantity: available,
    };
    const hash = createHash('sha256').update(JSON.stringify(push)).digest('hex');
    // 0 units: the offer stays on the marketplace but can't be bought.
    const status = available > 0 ? ListingStatus.ACTIVE : ListingStatus.PAUSED;

    if (hash === listing.lastSyncHash && listing.externalId) {
      // The marketplace already shows exactly this: no API call needed.
      await this.prisma.listing.update({ where: { id: listing.id }, data: { status, lastError: null } });
      return { status: SyncStatus.SKIPPED, detail: 'unchanged' };
    }

    const { externalId } = await connector.pushListing(push);
    await this.prisma.listing.update({
      where: { id: listing.id },
      data: {
        externalId,
        status,
        price: quote.price,
        currency: quote.currency,
        quantity: available,
        lastSyncHash: hash,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });
    return { status: SyncStatus.SUCCEEDED, detail: `${push.quantity} pcs at ${push.price} ${push.currency}` };
  }

  /** Fetches orders the marketplace has since the last pull and stores the new ones. */
  async pullOrders(marketplaceId: number, connector: MarketplaceConnector): Promise<JobResult> {
    const marketplace = await this.prisma.marketplace.findUniqueOrThrow({ where: { id: marketplaceId } });
    if (!marketplace.isEnabled) {
      return { status: SyncStatus.SKIPPED, detail: 'marketplace disabled' };
    }
    const startedAt = new Date();
    // Ask a bit further back than last time: late orders are caught, duplicates are ignored by ingest().
    const since = new Date((marketplace.ordersSyncedUntil?.getTime() ?? Date.now() - 24 * 3600_000) - ORDER_PULL_OVERLAP_MS);
    const orders = await connector.fetchOrders(since);

    let created = 0;
    for (const order of orders) {
      const result = await this.orders.ingest(marketplaceId, order);
      if (result.created) {
        created += 1;
      }
    }
    await this.prisma.marketplace.update({ where: { id: marketplaceId }, data: { ordersSyncedUntil: startedAt } });
    return { status: SyncStatus.SUCCEEDED, detail: `${orders.length} fetched, ${created} new` };
  }

  /** After the last attempt: the listing shows ERROR with the reason, so a person can act. */
  async markListingFailed(listingId: number, message: string): Promise<void> {
    await this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.ERROR, lastError: message.slice(0, 500) },
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { ListingStatus, type Inventory, type Listing, type Marketplace, type Product } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JOBS, PUSH_JOB_OPTIONS, queueName, type PushListingData } from './queues.js';

type ListingWithState = Listing & { marketplace: Marketplace; product: Product & { inventory: Inventory | null } };

const INCLUDE = { marketplace: true, product: { include: { inventory: true } } } as const;

/**
 * Puts "push this listing to its marketplace" jobs into the queues.
 *
 * The job carries only the listing id: the worker reads the current price and stock when it runs,
 * so a job that waited or was retried never pushes stale data.
 * The job id contains a hash of the state, so the same change queued twice while waiting is one job.
 */
@Injectable()
export class ListingSyncScheduler {
  private readonly logger = new Logger(ListingSyncScheduler.name);
  private readonly queues: Map<string, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(queueName('amazon')) amazon: Queue,
    @InjectQueue(queueName('ebay')) ebay: Queue,
    @InjectQueue(queueName('otto')) otto: Queue,
    @InjectQueue(queueName('kaufland')) kaufland: Queue,
  ) {
    this.queues = new Map([
      ['amazon', amazon],
      ['ebay', ebay],
      ['otto', otto],
      ['kaufland', kaufland],
    ]);
  }

  /** Re-pushes every published (non-draft) listing of these products, e.g. after a price or stock change. */
  async scheduleProducts(productIds: number[], reason: string): Promise<number> {
    if (productIds.length === 0) {
      return 0;
    }
    const listings = await this.prisma.listing.findMany({
      where: { productId: { in: productIds }, status: { not: ListingStatus.DRAFT }, marketplace: { isEnabled: true } },
      include: INCLUDE,
    });
    await Promise.all(listings.map((listing) => this.enqueue(listing, reason)));
    return listings.length;
  }

  /** Publishes a listing (first push) or pushes it again on request. */
  async scheduleListing(listingId: number, reason: string, force = false): Promise<boolean> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, include: INCLUDE });
    if (!listing || !listing.marketplace.isEnabled) {
      return false;
    }
    await this.enqueue(listing, reason, force);
    return true;
  }

  private async enqueue(listing: ListingWithState, reason: string, force = false): Promise<void> {
    const queue = this.queues.get(listing.marketplace.code);
    if (!queue) {
      this.logger.warn(`No queue for marketplace ${listing.marketplace.code}`);
      return;
    }
    // A manual retry must not be swallowed by an identical job that failed earlier.
    const suffix = force ? `-${Date.now()}` : '';
    const jobId = `listing-${listing.id}-${stateHash(listing)}${suffix}`;

    await this.prisma.listing.update({ where: { id: listing.id }, data: { status: ListingStatus.PENDING } });
    const data: PushListingData = { listingId: listing.id, reason };
    await queue.add(JOBS.pushListing, data, { ...PUSH_JOB_OPTIONS, jobId });
  }
}

/** Everything that changes what the marketplace should show. */
function stateHash(listing: ListingWithState): string {
  const { product, marketplace } = listing;
  const available = (product.inventory?.onHand ?? 0) - (product.inventory?.reserved ?? 0);
  const state = [
    product.title,
    product.ean,
    product.basePrice.toFixed(2),
    product.costPrice.toFixed(2),
    product.isActive,
    available,
    marketplace.feePercent.toFixed(2),
    marketplace.vatPercent.toFixed(2),
  ].join('|');
  return createHash('sha256').update(state).digest('hex').slice(0, 16);
}

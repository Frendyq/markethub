import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import type { Env } from '../config/env.js';
import { ListingStatus, SyncStatus, type Marketplace } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingClient } from '../pricing/pricing.client.js';
import { ConnectorRegistry } from '../connectors/connector.registry.js';
import {
  PermanentMarketplaceError,
  RateLimitedError,
  type ListingPush,
  type MarketplaceConnector,
} from '../connectors/connector.types.js';
import { OrdersService } from '../orders/orders.service.js';
import { JOBS, queueName, redisConnection, type PullOrdersData, type PushListingData } from '../sync/queues.js';

interface JobResult {
  status: SyncStatus;
  detail?: string;
}

const ORDER_PULL_OVERLAP_MS = 5 * 60_000;

/**
 * Starts one BullMQ worker per marketplace.
 *
 * - limiter: never more requests per second than the marketplace allows (from the marketplaces table);
 * - concurrency 1: jobs of one marketplace run in order, so an older state can't overwrite a newer one;
 * - 429: the whole queue pauses for Retry-After and the job goes back without using an attempt;
 * - 5xx and timeouts: the job is retried with exponential backoff;
 * - other 4xx: UnrecoverableError, no retries, the listing is marked ERROR.
 */
@Injectable()
export class SyncWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SyncWorkers.name);
  private readonly workers: Worker[] = [];
  private readonly queues: Queue[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingClient,
    private readonly connectors: ConnectorRegistry,
    private readonly orders: OrdersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const connection = redisConnection(this.config.get('REDIS_URL', { infer: true }));
    const pullEvery = this.config.get('ORDERS_PULL_EVERY_MS', { infer: true });
    const marketplaces = await this.prisma.marketplace.findMany({ orderBy: { id: 'asc' } });

    for (const marketplace of marketplaces) {
      if (!this.connectors.has(marketplace.code)) {
        continue;
      }
      const connector = this.connectors.get(marketplace.code);
      const name = queueName(marketplace.code);

      const worker: Worker = new Worker(name, (job: Job) => this.process(worker, job, marketplace, connector), {
        connection,
        concurrency: 1,
        limiter: { max: marketplace.rateLimitPerSec, duration: 1000 },
      });
      worker.on('completed', (job, result: JobResult) => void this.record(job, marketplace.id, result.status, result.detail));
      worker.on('failed', (job, error) => job && void this.onFailed(job, marketplace.id, error));
      worker.on('error', (error) => this.logger.error(`${name}: ${error.message}`));
      this.workers.push(worker);

      // Safety net for missed webhooks: poll for orders on a schedule. Upsert keeps one schedule per marketplace.
      const queue = new Queue(name, { connection });
      this.queues.push(queue);
      await queue.upsertJobScheduler(
        `pull-orders-${marketplace.code}`,
        { every: pullEvery },
        {
          name: JOBS.pullOrders,
          data: { marketplaceId: marketplace.id } satisfies PullOrdersData,
          opts: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 100 },
        },
      );
      this.logger.log(`Worker for ${name}: ${marketplace.rateLimitPerSec} req/s, orders every ${pullEvery / 1000} s`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Let running jobs finish, then close connections.
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all(this.queues.map((queue) => queue.close()));
  }

  private async process(worker: Worker, job: Job, marketplace: Marketplace, connector: MarketplaceConnector): Promise<JobResult> {
    try {
      switch (job.name) {
        case JOBS.pushListing:
          return await this.pushListing(job.data as PushListingData, connector);
        case JOBS.pullOrders:
          return await this.pullOrders(marketplace.id, connector);
        default:
          throw new UnrecoverableError(`Unknown job ${job.name}`);
      }
    } catch (error) {
      if (error instanceof RateLimitedError) {
        this.logger.warn(error.message);
        await worker.rateLimit(error.retryAfterMs);
        throw Worker.RateLimitError();
      }
      if (error instanceof PermanentMarketplaceError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  private async pushListing(data: PushListingData, connector: MarketplaceConnector): Promise<JobResult> {
    // Read the current state now, not when the job was queued.
    const listing = await this.prisma.listing.findUnique({
      where: { id: data.listingId },
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

  private async pullOrders(marketplaceId: number, connector: MarketplaceConnector): Promise<JobResult> {
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

  private async onFailed(job: Job, marketplaceId: number, error: Error): Promise<void> {
    // A rate-limited job is not a failure: it goes back to the queue.
    if (error.name === 'RateLimitError' || error.message === 'bullmq:rateLimitExceeded') {
      return;
    }
    const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(`${job.name} ${job.id} attempt ${job.attemptsMade} failed${final ? ' for good' : ''}: ${error.message}`);
    if (!final) {
      return;
    }
    if (job.name === JOBS.pushListing) {
      const { listingId } = job.data as PushListingData;
      await this.prisma.listing
        .update({ where: { id: listingId }, data: { status: ListingStatus.ERROR, lastError: error.message.slice(0, 500) } })
        .catch(() => undefined);
    }
    await this.record(job, marketplaceId, SyncStatus.FAILED, error.message);
  }

  private async record(job: Job, marketplaceId: number, status: SyncStatus, detail?: string): Promise<void> {
    const listingId = job.name === JOBS.pushListing ? (job.data as PushListingData).listingId : null;
    const durationMs = job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null;
    await this.prisma.syncRun
      .create({
        data: {
          marketplaceId,
          listingId,
          jobName: job.name,
          jobId: job.id,
          status,
          attempts: job.attemptsMade,
          durationMs,
          error: status === SyncStatus.FAILED ? detail?.slice(0, 500) : null,
        },
      })
      .catch((error: unknown) => this.logger.warn(`sync_runs write failed: ${String(error)}`));
  }
}

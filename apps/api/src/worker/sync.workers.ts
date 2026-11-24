import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Env } from '../config/env.js';
import { SyncStatus, type Marketplace } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConnectorRegistry } from '../connectors/connector.registry.js';
import type { MarketplaceConnector } from '../connectors/connector.types.js';
import { JOBS, queueName, redisConnection, type PullOrdersData, type PushListingData } from '../sync/queues.js';
import { classifyFailure, SyncJobs, type JobResult } from './sync.jobs.js';

/**
 * Starts one BullMQ worker per marketplace and wires it to SyncJobs.
 *
 * - limiter: never more requests per second than the marketplace allows (from the marketplaces table);
 * - concurrency 1: jobs of one marketplace run in order, so an older state can't overwrite a newer one;
 * - 429: the whole queue pauses for Retry-After and the job goes back without using an attempt;
 * - 5xx and timeouts: the job is retried with exponential backoff;
 * - other 4xx: UnrecoverableError, no retries, the listing is marked ERROR.
 *
 * The limiter is read at startup: after changing a marketplace's limit, restart the worker.
 */
@Injectable()
export class SyncWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SyncWorkers.name);
  private readonly workers: Worker[] = [];
  private readonly queues: Queue[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: SyncJobs,
    private readonly connectors: ConnectorRegistry,
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
          return await this.jobs.pushListing((job.data as PushListingData).listingId, connector);
        case JOBS.pullOrders:
          return await this.jobs.pullOrders(marketplace.id, connector);
        default:
          throw new UnrecoverableError(`Unknown job ${job.name}`);
      }
    } catch (error) {
      const action = classifyFailure(error);
      if (action.kind === 'rate-limit') {
        this.logger.warn(`${marketplace.code}: rate limited, pausing ${action.delayMs} ms`);
        await worker.rateLimit(action.delayMs);
        throw Worker.RateLimitError();
      }
      if (action.kind === 'give-up') {
        throw new UnrecoverableError(action.message);
      }
      throw error;
    }
  }

  private async onFailed(job: Job, marketplaceId: number, error: Error): Promise<void> {
    const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(`${job.name} ${job.id} attempt ${job.attemptsMade} failed${final ? ' for good' : ''}: ${error.message}`);
    if (!final) {
      return;
    }
    if (job.name === JOBS.pushListing) {
      await this.jobs.markListingFailed((job.data as PushListingData).listingId, error.message).catch(() => undefined);
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

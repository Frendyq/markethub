import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions, JobsOptions } from 'bullmq';
import type { Env } from '../config/env.js';
import { MARKETPLACE_CODES } from '../connectors/connector.registry.js';

/**
 * One queue per marketplace. Each queue gets its own worker with a rate limiter
 * that matches that marketplace's API limit, and one slow marketplace can't hold up the others.
 */
export const queueName = (code: string) => `marketplace-${code}`;
export const MARKETPLACE_QUEUES = MARKETPLACE_CODES.map(queueName);

export const JOBS = {
  pushListing: 'push-listing',
  pullOrders: 'pull-orders',
} as const;

export interface PushListingData {
  listingId: number;
  reason: string;
}

export interface PullOrdersData {
  marketplaceId: number;
}

/** Retries with growing pauses: 2 s, 4 s, 8 s, 16 s, 32 s. */
export const PUSH_JOB_OPTIONS: JobsOptions = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: { age: 24 * 3600 },
};

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    // Required by BullMQ workers: a blocked command must wait for Redis, not fail.
    maxRetriesPerRequest: null,
  };
}

/** Registered once in each root module (AppModule, WorkerModule). */
export const bullRoot = BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    connection: redisConnection(config.get('REDIS_URL', { infer: true })),
  }),
});

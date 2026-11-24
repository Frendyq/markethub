import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnrecoverableError, Worker, type Queue } from 'bullmq';
import { validateEnv } from '../src/config/env.js';
import {
  TransientMarketplaceError,
  type ExternalOrder,
  type ListingPush,
  type MarketplaceConnector,
} from '../src/connectors/connector.types.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import { PricingClient } from '../src/pricing/pricing.client.js';
import { PricingModule } from '../src/pricing/pricing.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ListingSyncScheduler } from '../src/sync/listing-sync.scheduler.js';
import { bullRoot, queueName, redisConnection } from '../src/sync/queues.js';
import { SyncModule } from '../src/sync/sync.module.js';
import { SyncJobs } from '../src/worker/sync.jobs.js';
import { resetDatabase } from './utils.js';

/** A marketplace that records what it receives and returns the orders we give it. */
function fakeMarketplace(code = 'amazon') {
  const pushed: ListingPush[] = [];
  let orders: ExternalOrder[] = [];
  const connector = {
    code,
    pushListing: vi.fn(async (listing: ListingPush) => {
      pushed.push(listing);
      return { externalId: `EXT-${listing.sku}` };
    }),
    fetchOrders: vi.fn(async (_since: Date) => orders),
    parseOrder: vi.fn(),
  } satisfies MarketplaceConnector;
  return { connector, pushed, setOrders: (next: ExternalOrder[]) => (orders = next) };
}

// The Rust service is tested on its own; here a price is simply base price x 1.5.
const pricing = {
  calculate: vi.fn(async (marketplace: string, items: { sku: string; basePrice: string }[]) => ({
    marketplace,
    currency: 'EUR',
    minMarginPercent: '10',
    items: items.map((i) => ({ sku: i.sku, price: (Number(i.basePrice) * 1.5).toFixed(2), currency: 'EUR' })),
  })),
  validateFeed: vi.fn(),
};

describe('queue jobs (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jobs: SyncJobs;

  beforeAll(async () => {
    // What the worker process runs, without starting BullMQ workers.
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
        bullRoot,
        SyncModule,
        PricingModule,
        OrdersModule,
      ],
      providers: [SyncJobs],
    })
      .overrideProvider(PricingClient)
      .useValue(pricing)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    jobs = moduleRef.get(SyncJobs);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await moduleRef.get<Queue>(getQueueToken(queueName('amazon'))).obliterate({ force: true });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function listedProduct(stock: number, overrides: { isActive?: boolean } = {}) {
    const product = await prisma.product.create({
      data: {
        sku: 'TAB-SYNC-OAK',
        title: 'Sync table',
        category: 'tables',
        costPrice: '100.00',
        basePrice: '200.00',
        weightKg: '20',
        widthCm: 120,
        heightCm: 75,
        depthCm: 70,
        isActive: overrides.isActive ?? true,
        inventory: { create: { onHand: stock } },
      },
    });
    const listing = await prisma.listing.create({ data: { productId: product.id, marketplaceId: 1, status: 'PENDING' } });
    return { product, listing };
  }

  describe('push-listing', () => {
    it('sends the current price and available stock and marks the listing active', async () => {
      const { listing } = await listedProduct(5);
      await prisma.inventory.update({ where: { productId: listing.productId }, data: { reserved: 2 } });
      const market = fakeMarketplace();

      const result = await jobs.pushListing(listing.id, market.connector);

      expect(result.status).toBe('SUCCEEDED');
      expect(market.pushed).toEqual([
        { sku: 'TAB-SYNC-OAK', title: 'Sync table', ean: null, price: '300.00', currency: 'EUR', quantity: 3 },
      ]);
      const saved = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(saved).toMatchObject({ status: 'ACTIVE', externalId: 'EXT-TAB-SYNC-OAK', quantity: 3, currency: 'EUR', lastError: null });
      expect(saved.price?.toFixed(2)).toBe('300.00');
    });

    it('makes no API call when the marketplace already shows the same thing', async () => {
      const { listing } = await listedProduct(5);
      const market = fakeMarketplace();
      await jobs.pushListing(listing.id, market.connector);

      const again = await jobs.pushListing(listing.id, market.connector);

      expect(again).toEqual({ status: 'SKIPPED', detail: 'unchanged' });
      expect(market.connector.pushListing).toHaveBeenCalledTimes(1);
    });

    it('pushes 0 units and pauses the listing when nothing is available or the product is archived', async () => {
      const soldOut = await listedProduct(0);
      const market = fakeMarketplace();
      await jobs.pushListing(soldOut.listing.id, market.connector);
      expect(market.pushed[0].quantity).toBe(0);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: soldOut.listing.id } })).status).toBe('PAUSED');

      // Restocked: 10 units go out.
      await prisma.inventory.update({ where: { productId: soldOut.product.id }, data: { onHand: 10 } });
      await jobs.pushListing(soldOut.listing.id, market.connector);
      expect(market.pushed[1].quantity).toBe(10);

      // Archived with 10 units on the shelf: the marketplace gets 0.
      await prisma.product.update({ where: { id: soldOut.product.id }, data: { isActive: false } });
      await jobs.pushListing(soldOut.listing.id, market.connector);
      expect(market.pushed[2].quantity).toBe(0);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: soldOut.listing.id } })).status).toBe('PAUSED');
    });

    it('skips a disabled marketplace without calling it', async () => {
      const { listing } = await listedProduct(5);
      await prisma.marketplace.update({ where: { id: 1 }, data: { isEnabled: false } });
      const market = fakeMarketplace();

      expect((await jobs.pushListing(listing.id, market.connector)).status).toBe('SKIPPED');
      expect(market.connector.pushListing).not.toHaveBeenCalled();
    });

    it('leaves the listing untouched when the marketplace fails, so the retry starts clean', async () => {
      const { listing } = await listedProduct(5);
      const market = fakeMarketplace();
      market.connector.pushListing.mockRejectedValueOnce(new TransientMarketplaceError('amazon answered 503'));

      await expect(jobs.pushListing(listing.id, market.connector)).rejects.toBeInstanceOf(TransientMarketplaceError);
      expect(await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ status: 'PENDING', externalId: null });

      await jobs.markListingFailed(listing.id, 'amazon answered 400: bad title');
      expect(await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({
        status: 'ERROR',
        lastError: 'amazon answered 400: bad title',
      });
    });
  });

  describe('pull-orders', () => {
    const order = (id: string): ExternalOrder => ({
      externalId: id,
      placedAt: new Date(),
      currency: 'EUR',
      total: '300.00',
      customerName: 'Mia',
      items: [{ sku: 'TAB-SYNC-OAK', quantity: 1, unitPrice: '300.00' }],
    });

    it('stores new orders, ignores the ones it already has and remembers how far it got', async () => {
      await listedProduct(5);
      const market = fakeMarketplace();
      market.setOrders([order('A-1'), order('A-2')]);

      expect(await jobs.pullOrders(1, market.connector)).toEqual({ status: 'SUCCEEDED', detail: '2 fetched, 2 new' });
      expect(await jobs.pullOrders(1, market.connector)).toEqual({ status: 'SUCCEEDED', detail: '2 fetched, 0 new' });

      expect(await prisma.order.count()).toBe(2);
      const inventory = await prisma.inventory.findFirstOrThrow();
      expect(inventory.reserved).toBe(2);

      const marketplace = await prisma.marketplace.findUniqueOrThrow({ where: { id: 1 } });
      expect(marketplace.ordersSyncedUntil).not.toBeNull();
      // The next pull asks a little further back than where the last one ended.
      const since = market.connector.fetchOrders.mock.calls[1][0];
      expect(since.getTime()).toBeLessThan(marketplace.ordersSyncedUntil!.getTime());
    });
  });

  describe('scheduler', () => {
    it('replaces a job that failed earlier instead of leaving the listing pending forever', async () => {
      const { listing } = await listedProduct(5);
      const scheduler = moduleRef.get(ListingSyncScheduler);
      const queue = moduleRef.get<Queue>(getQueueToken(queueName('amazon')));
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'ACTIVE' } });

      // First push fails for good.
      await scheduler.scheduleListing(listing.id, 'test');
      const worker = new Worker(
        queueName('amazon'),
        async () => {
          throw new UnrecoverableError('rejected');
        },
        { connection: redisConnection(process.env.REDIS_URL!) },
      );
      await new Promise((resolve) => worker.once('failed', resolve));
      await worker.close();
      expect(await queue.getJobCountByTypes('failed')).toBe(1);

      // Same state queued again: the failed job is replaced by a waiting one.
      await scheduler.scheduleListing(listing.id, 'test again');
      expect(await queue.getJobCountByTypes('failed')).toBe(0);
      expect(await queue.getJobCountByTypes('waiting')).toBe(1);
    });
  });
});

import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHmac, randomUUID } from 'node:crypto';
import { PricingClient } from '../src/pricing/pricing.client.js';
import { ADMIN, createTestApp, MANAGER, resetDatabase, sampleProduct, signIn, type TestContext } from './utils.js';

// Routes the panel uses that the other files don't cover.

const pricing = {
  calculate: vi.fn(async (marketplace: string, items: { sku: string; basePrice: string }[]) => ({
    marketplace,
    currency: marketplace === 'ebay' ? 'USD' : 'EUR',
    minMarginPercent: '10',
    items: items.map((i) => ({
      sku: i.sku,
      price: '374.99',
      currency: marketplace === 'ebay' ? 'USD' : 'EUR',
      vatAmount: '59.87',
      feeAmount: '52.50',
      proceeds: '262.62',
      proceedsEur: '262.62',
      marginEur: '162.62',
      marginPercent: '61.92',
      belowMinMargin: false,
    })),
  })),
  validateFeed: vi.fn(),
};

describe('panel API (e2e)', () => {
  let ctx: TestContext;
  let admin: { Authorization: string };

  beforeAll(async () => {
    ctx = await createTestApp((builder) => builder.overrideProvider(PricingClient).useValue(pricing));
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    for (const code of ['amazon', 'ebay', 'otto', 'kaufland']) {
      await ctx.app.get<Queue>(getQueueToken(`marketplace-${code}`)).obliterate({ force: true });
    }
    admin = { Authorization: `Bearer ${await signIn(ctx, ADMIN)}` };
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const createProduct = async (overrides: Record<string, unknown> = {}) =>
    (await ctx.http().post('/api/products').set(admin).send(sampleProduct(overrides)).expect(201)).body as { id: number; sku: string };

  const webhookOrder = async (sku: string, id: string, quantity = 1) => {
    const raw = JSON.stringify({
      type: 'order.created',
      order: {
        AmazonOrderId: id,
        PurchaseDate: new Date().toISOString(),
        BuyerName: 'Jonas Becker',
        OrderTotal: { Amount: '249.99', CurrencyCode: 'EUR' },
        OrderItems: [{ SellerSKU: sku, QuantityOrdered: quantity, ItemPrice: { Amount: '249.99' } }],
      },
    });
    const res = await ctx
      .http()
      .post('/api/webhooks/amazon')
      .set('content-type', 'application/json')
      .set('x-event-id', randomUUID())
      .set('x-markethub-signature', `sha256=${createHmac('sha256', 'test-webhook-secret').update(raw).digest('hex')}`)
      .send(raw)
      .expect(200);
    return res.body.orderId as number;
  };

  it('reports readiness of PostgreSQL and Redis without a token', async () => {
    await ctx.http().get('/health').expect(200, { status: 'ok' });
    await ctx.http().get('/ready').expect(200, { status: 'ok', database: 'up', redis: 'up' });
  });

  it('returns marketplace prices from the pricing-engine for every enabled marketplace', async () => {
    const product = await createProduct();
    const res = await ctx.http().get(`/api/products/${product.id}/prices`).set(admin).expect(200);
    // Kaufland is disabled in the test data.
    expect(res.body.map((p: { marketplace: string }) => p.marketplace)).toEqual(['amazon', 'ebay', 'otto']);
    expect(res.body[1]).toMatchObject({ currency: 'USD', price: '374.99', belowMinMargin: false });
    expect(pricing.calculate).toHaveBeenCalledWith('amazon', [{ sku: product.sku, basePrice: '249.99', costPrice: '100.00' }]);
  });

  it('lists categories', async () => {
    await createProduct({ sku: 'SOF-A-GRY', category: 'sofas' });
    await createProduct({ sku: 'TAB-A-OAK', category: 'tables' });
    await ctx.http().get('/api/products/categories').set(admin).expect(200, ['sofas', 'tables']);
  });

  it('publishes a listing on request and refuses unknown or disabled ones', async () => {
    const product = await createProduct();
    const listings = (await ctx.http().post('/api/listings').set(admin).send({ productId: product.id }).expect(201)).body as {
      id: number;
      status: string;
    }[];
    expect(listings.every((l) => l.status === 'DRAFT')).toBe(true);

    const published = await ctx.http().post(`/api/listings/${listings[0].id}/publish`).set(admin).expect(202);
    expect(published.body.status).toBe('PENDING');
    expect(await ctx.app.get<Queue>(getQueueToken('marketplace-amazon')).getJobCountByTypes('waiting')).toBe(1);

    await ctx.http().post('/api/listings/999/publish').set(admin).expect(404);

    await ctx.prisma.marketplace.update({ where: { id: 1 }, data: { isEnabled: false } });
    await ctx.http().post(`/api/listings/${listings[0].id}/publish`).set(admin).expect(400);
  });

  it('filters listings by status and marketplace', async () => {
    const product = await createProduct();
    await ctx.http().post('/api/listings').set(admin).send({ productId: product.id, marketplaceIds: [1, 2] }).expect(201);
    await ctx.prisma.listing.updateMany({ where: { marketplaceId: 2 }, data: { status: 'ERROR', lastError: 'boom' } });

    const errors = await ctx.http().get('/api/listings?status=ERROR').set(admin).expect(200);
    expect(errors.body.items).toEqual([expect.objectContaining({ marketplace: 'ebay', lastError: 'boom' })]);
    const amazon = await ctx.http().get('/api/listings?marketplaceId=1').set(admin).expect(200);
    expect(amazon.body.total).toBe(1);
    await ctx.http().get('/api/listings?status=WRONG').set(admin).expect(400);
  });

  it('filters and searches orders, and walks an order to delivered', async () => {
    const product = await createProduct({ initialStock: 5 });
    const first = await webhookOrder(product.sku, 'A-100');
    await webhookOrder('UNKNOWN-SKU', 'A-200');

    const reserved = await ctx.http().get('/api/orders?status=RESERVED').set(admin).expect(200);
    expect(reserved.body.items.map((o: { externalId: string }) => o.externalId)).toEqual(['A-100']);
    const search = await ctx.http().get('/api/orders?search=a-2').set(admin).expect(200);
    expect(search.body.items.map((o: { externalId: string }) => o.externalId)).toEqual(['A-200']);
    await ctx.http().get('/api/orders?search=jonas').set(admin).expect(200);

    await ctx.http().post(`/api/orders/${first}/deliver`).set(admin).expect(409);
    await ctx.http().post(`/api/orders/${first}/ship`).set(admin).expect(200);
    const delivered = await ctx.http().post(`/api/orders/${first}/deliver`).set(admin).expect(200);
    expect(delivered.body.status).toBe('DELIVERED');
    await ctx.http().get('/api/orders/999').set(admin).expect(404);
  });

  it('summarizes the day on the dashboard', async () => {
    const product = await createProduct({ initialStock: 1 });
    await createProduct({ sku: 'CHA-LOW-BLK', initialStock: 2 });
    await webhookOrder(product.sku, 'A-300');
    await webhookOrder(product.sku, 'A-301'); // nothing left: backordered

    const res = await ctx.http().get('/api/dashboard').set(admin).expect(200);
    expect(res.body.products).toEqual({ total: 2, active: 2, lowStock: 1, outOfStock: 1 });
    expect(res.body.orders).toMatchObject({ today: 2, reserved: 1, backordered: 1 });
    expect(res.body.orders.revenueToday).toEqual([{ currency: 'EUR', amount: '499.98' }]);
    expect(res.body.recentOrders).toHaveLength(2);
    expect(res.body.listings).toMatchObject({ ACTIVE: 0, DRAFT: 0, ERROR: 0 });
  });

  it('lets only an admin change marketplace settings, and validates them', async () => {
    const manager = { Authorization: `Bearer ${await signIn(ctx, MANAGER)}` };
    await ctx.http().patch('/api/marketplaces/1').set(manager).send({ feePercent: '10.00' }).expect(403);
    await ctx.http().patch('/api/marketplaces/1').set(admin).send({ feePercent: 'ten' }).expect(400);
    const res = await ctx.http().patch('/api/marketplaces/1').set(admin).send({ feePercent: '10.5', rateLimitPerSec: 2 }).expect(200);
    expect(res.body).toMatchObject({ code: 'amazon', feePercent: '10.50', rateLimitPerSec: 2 });
    await ctx.http().patch('/api/marketplaces/99').set(admin).send({ isEnabled: false }).expect(404);
  });

  it('shows stock history newest first', async () => {
    const product = await createProduct({ initialStock: 3 });
    await ctx.http().post(`/api/inventory/${product.id}/movements`).set(admin).send({ type: 'RECEIPT', quantity: 2, reason: 'delivery' }).expect(201);
    await ctx.http().post(`/api/inventory/${product.id}/movements`).set(admin).send({ type: 'RECEIPT', quantity: -2 }).expect(400);
    const res = await ctx.http().get(`/api/inventory/${product.id}/movements`).set(admin).expect(200);
    expect(res.body.items.map((m: { quantity: number }) => m.quantity)).toEqual([2, 3]);
    await ctx.http().get('/api/inventory/999').set(admin).expect(404);
  });
});

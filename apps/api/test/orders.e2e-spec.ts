import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHmac, randomUUID } from 'node:crypto';
import { ADMIN, createTestApp, resetDatabase, sampleProduct, signIn, type TestContext } from './utils.js';

const SECRET = 'test-webhook-secret';

/** An OTTO-format "order created" webhook body. */
function ottoOrder(id: string, sku: string, units: number, price = '299.99') {
  return {
    type: 'order.created',
    order: {
      salesOrderId: id,
      orderDate: new Date().toISOString(),
      buyerName: 'Anna Schmidt',
      positionItems: Array.from({ length: units }, () => ({
        product: { sku },
        itemValueGrossPrice: { amount: price, currency: 'EUR' },
      })),
    },
  };
}

function amazonOrder(id: string, sku: string, quantity: number) {
  return {
    type: 'order.created',
    order: {
      AmazonOrderId: id,
      PurchaseDate: new Date().toISOString(),
      BuyerName: 'Lukas Weber',
      OrderTotal: { Amount: '599.98', CurrencyCode: 'EUR' },
      OrderItems: [{ SellerSKU: sku, QuantityOrdered: quantity, ItemPrice: { Amount: '299.99', CurrencyCode: 'EUR' } }],
    },
  };
}

describe('orders and webhooks (e2e)', () => {
  let ctx: TestContext;
  let auth: { Authorization: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    for (const code of ['amazon', 'ebay', 'otto', 'kaufland']) {
      await ctx.app.get<Queue>(getQueueToken(`marketplace-${code}`)).obliterate({ force: true });
    }
    auth = { Authorization: `Bearer ${await signIn(ctx, ADMIN)}` };
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const createProduct = async (stock: number, sku = 'TAB-TEST-OAK') =>
    (await ctx.http().post('/api/products').set(auth).send(sampleProduct({ sku, initialStock: stock })).expect(201)).body as {
      id: number;
      sku: string;
    };

  const sendWebhook = (code: string, body: object, eventId = randomUUID(), secret = SECRET) => {
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return ctx
      .http()
      .post(`/api/webhooks/${code}`)
      .set('content-type', 'application/json')
      .set('x-event-id', eventId)
      .set('x-markethub-signature', signature)
      .send(raw);
  };

  const stock = async (productId: number) =>
    (await ctx.http().get(`/api/inventory/${productId}`).set(auth).expect(200)).body as { onHand: number; reserved: number };

  it('rejects a webhook with a wrong signature', async () => {
    const product = await createProduct(5);
    await sendWebhook('otto', ottoOrder('O-1', product.sku, 1), randomUUID(), 'wrong-secret').expect(401);
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('stores an order once and reserves its stock, however many times it arrives', async () => {
    const product = await createProduct(5);
    const eventId = randomUUID();

    const first = await sendWebhook('otto', ottoOrder('O-1', product.sku, 2), eventId).expect(200);
    expect(first.body.status).toBe('processed');

    // The same delivery again, and the same order as a different event (e.g. also seen by polling).
    expect((await sendWebhook('otto', ottoOrder('O-1', product.sku, 2), eventId).expect(200)).body.status).toBe('duplicate');
    expect((await sendWebhook('otto', ottoOrder('O-1', product.sku, 2)).expect(200)).body.status).toBe('duplicate');

    const orders = await ctx.http().get('/api/orders').set(auth).expect(200);
    expect(orders.body.total).toBe(1);
    // OTTO sends one position per unit; we store one line with quantity 2.
    expect(orders.body.items[0]).toMatchObject({
      marketplace: 'otto',
      externalId: 'O-1',
      status: 'RESERVED',
      totalAmount: '599.98',
      items: [{ sku: product.sku, quantity: 2, unitPrice: '299.99' }],
    });
    expect(await stock(product.id)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });
  });

  it('sells the last unit once when two marketplaces order it at the same moment', async () => {
    const product = await createProduct(1);
    const [otto, amazon] = await Promise.all([
      sendWebhook('otto', ottoOrder('O-LAST', product.sku, 1)),
      sendWebhook('amazon', amazonOrder('A-LAST', product.sku, 1)),
    ]);
    expect(otto.status).toBe(200);
    expect(amazon.status).toBe(200);

    const statuses = (await ctx.prisma.order.findMany({ select: { status: true } })).map((o) => o.status).sort();
    expect(statuses).toEqual(['BACKORDERED', 'RESERVED']);
    expect(await stock(product.id)).toMatchObject({ onHand: 1, reserved: 1, available: 0 });
  });

  it('backorders an order with an unknown SKU without touching stock', async () => {
    const product = await createProduct(5);
    await sendWebhook('amazon', amazonOrder('A-UNKNOWN', 'NO-SUCH-SKU', 1)).expect(200);
    const order = await ctx.prisma.order.findFirstOrThrow();
    expect(order.status).toBe('BACKORDERED');
    expect(await stock(product.id)).toMatchObject({ reserved: 0 });
  });

  it('rejects a webhook body it cannot understand', async () => {
    await sendWebhook('amazon', { type: 'order.created', order: { AmazonOrderId: 'A-BROKEN' } }).expect(400);
  });

  it('ships a reserved order once and moves stock out of the warehouse', async () => {
    const product = await createProduct(5);
    const { body } = await sendWebhook('otto', ottoOrder('O-SHIP', product.sku, 2)).expect(200);

    const shipped = await ctx.http().post(`/api/orders/${body.orderId}/ship`).set(auth).expect(200);
    expect(shipped.body.status).toBe('SHIPPED');
    expect(await stock(product.id)).toMatchObject({ onHand: 3, reserved: 0, available: 3 });

    const again = await ctx.http().post(`/api/orders/${body.orderId}/ship`).set(auth).expect(409);
    expect(again.body.message).toContain('SHIPPED');
    await ctx.http().post(`/api/orders/${body.orderId}/cancel`).set(auth).expect(409);
  });

  it('returns reserved stock when an order is cancelled', async () => {
    const product = await createProduct(5);
    const { body } = await sendWebhook('otto', ottoOrder('O-CANCEL', product.sku, 3)).expect(200);
    expect(await stock(product.id)).toMatchObject({ reserved: 3 });

    await ctx.http().post(`/api/orders/${body.orderId}/cancel`).set(auth).expect(200);
    expect(await stock(product.id)).toMatchObject({ onHand: 5, reserved: 0 });
    const movements = await ctx.prisma.stockMovement.findMany({ where: { orderId: body.orderId }, orderBy: { id: 'asc' } });
    expect(movements.map((m) => [m.type, m.quantity])).toEqual([
      ['RESERVE', 3],
      ['RELEASE', -3],
    ]);
  });

  it('queues a push to every marketplace of a published product when its stock changes', async () => {
    const product = await createProduct(5);
    await ctx.http().post('/api/listings').set(auth).send({ productId: product.id, publish: true }).expect(201);

    const amazon = ctx.app.get<Queue>(getQueueToken('marketplace-amazon'));
    expect(await amazon.getJobCountByTypes('waiting', 'delayed')).toBe(1);
    const listing = await ctx.prisma.listing.findFirstOrThrow({ where: { marketplace: { code: 'amazon' } } });
    expect(listing.status).toBe('PENDING');

    // The same state queued again while the first job waits: still one job.
    await ctx.http().patch(`/api/products/${product.id}`).set(auth).send({ title: 'Test table, oak' }).expect(200);
    expect(await amazon.getJobCountByTypes('waiting', 'delayed')).toBe(1);

    // A real change: a second job.
    await ctx
      .http()
      .post(`/api/inventory/${product.id}/movements`)
      .set(auth)
      .send({ type: 'RECEIPT', quantity: 2 })
      .expect(201);
    const jobs = await amazon.getJobs(['waiting', 'delayed']);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.name === 'push-listing' && job.data.listingId === listing.id)).toBe(true);
  });
});

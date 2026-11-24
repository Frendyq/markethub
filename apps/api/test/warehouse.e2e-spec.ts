import { createHmac, randomUUID } from 'node:crypto';
import { ADMIN, createTestApp, MANAGER, resetDatabase, sampleProduct, signIn, type TestContext } from './utils.js';

// What the MarketHub Warehouse desktop app needs from the API.

describe('warehouse API (e2e)', () => {
  let ctx: TestContext;
  let admin: { Authorization: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    admin = { Authorization: `Bearer ${await signIn(ctx, ADMIN)}` };
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const createProduct = async (overrides: Record<string, unknown> = {}) =>
    (await ctx.http().post('/api/products').set(admin).send(sampleProduct(overrides)).expect(201)).body as {
      id: number;
      sku: string;
      location: string | null;
    };

  const order = async (id: string, items: { sku: string; qty: number }[]) => {
    const raw = JSON.stringify({
      type: 'order.created',
      order: {
        AmazonOrderId: id,
        PurchaseDate: new Date().toISOString(),
        BuyerName: 'Mia Fischer',
        OrderTotal: { Amount: '100.00', CurrencyCode: 'EUR' },
        OrderItems: items.map((i) => ({ SellerSKU: i.sku, QuantityOrdered: i.qty, ItemPrice: { Amount: '50.00' } })),
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

  const stock = async (productId: number) =>
    (await ctx.http().get(`/api/inventory/${productId}`).set(admin).expect(200)).body as { onHand: number; reserved: number };

  it('stores a warehouse location and validates it', async () => {
    const product = await createProduct({ location: 'B-07-3' });
    expect(product.location).toBe('B-07-3');
    await ctx.http().post('/api/products').set(admin).send(sampleProduct({ sku: 'TAB-X-OAK', location: 'shelf 3' })).expect(400);
    const moved = await ctx.http().patch(`/api/products/${product.id}`).set(admin).send({ location: 'C-01-1' }).expect(200);
    expect(moved.body.location).toBe('C-01-1');
  });

  it('finds a product by the barcode on the box', async () => {
    await createProduct({ ean: '4006381333931' });
    const found = await ctx.http().get('/api/products/by-ean/4006381333931').set(admin).expect(200);
    expect(found.body).toMatchObject({ sku: 'TAB-TEST-OAK', stock: { onHand: 5 } });
    await ctx.http().get('/api/products/by-ean/4000000000000').set(admin).expect(404);
    await ctx.http().get('/api/products/by-ean/abc').set(admin).expect(400);
  });

  it('lists reserved orders to pick, oldest first, lines sorted by location', async () => {
    const desk = await createProduct({ sku: 'DES-A-OAK', ean: '4006381333931', location: 'C-02-1' });
    const chair = await createProduct({ sku: 'CHA-A-BLK', location: 'A-05-2' });
    const first = await order('A-1', [
      { sku: desk.sku, qty: 1 },
      { sku: chair.sku, qty: 2 },
    ]);
    await order('A-2', [{ sku: 'UNKNOWN', qty: 1 }]); // backordered: not in the picking list
    const second = await order('A-3', [{ sku: chair.sku, qty: 1 }]);

    const res = await ctx.http().get('/api/warehouse/picking').set(admin).expect(200);
    expect(res.body.map((o: { id: number }) => o.id)).toEqual([first, second]);
    expect(res.body[0]).toMatchObject({ marketplace: 'amazon', externalId: 'A-1', customerName: 'Mia Fischer' });
    expect(res.body[0].items).toEqual([
      { productId: chair.id, sku: 'CHA-A-BLK', title: 'Test table, oak', ean: null, location: 'A-05-2', quantity: 2 },
      { productId: desk.id, sku: 'DES-A-OAK', title: 'Test table, oak', ean: '4006381333931', location: 'C-02-1', quantity: 1 },
    ]);
  });

  describe('Idempotency-Key', () => {
    it('ships once when the app retries after losing the answer', async () => {
      const product = await createProduct({ initialStock: 5 });
      const orderId = await order('A-10', [{ sku: product.sku, qty: 2 }]);
      const key = randomUUID();

      const first = await ctx.http().post(`/api/orders/${orderId}/ship`).set(admin).set('Idempotency-Key', key).expect(200);
      const retry = await ctx.http().post(`/api/orders/${orderId}/ship`).set(admin).set('Idempotency-Key', key).expect(200);
      expect(first.body.status).toBe('SHIPPED');
      expect(retry.body.status).toBe('SHIPPED');
      expect(await stock(product.id)).toMatchObject({ onHand: 3, reserved: 0 });
      expect(await ctx.prisma.stockMovement.count({ where: { type: 'SHIPMENT' } })).toBe(1);

      // Without the key a second ship is a conflict, as before.
      await ctx.http().post(`/api/orders/${orderId}/ship`).set(admin).expect(409);
    });

    it('applies a stock movement once, even for parallel retries', async () => {
      const product = await createProduct({ initialStock: 5 });
      const key = randomUUID();
      const send = () =>
        ctx
          .http()
          .post(`/api/inventory/${product.id}/movements`)
          .set(admin)
          .set('Idempotency-Key', key)
          .send({ type: 'RECEIPT', quantity: 3, reason: 'delivery' });

      const results = await Promise.all([send(), send(), send()]);
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(results.every((r) => r.body.onHand === 8)).toBe(true);
      expect(await stock(product.id)).toMatchObject({ onHand: 8 });
      expect(await ctx.prisma.stockMovement.count({ where: { type: 'RECEIPT', reason: 'delivery' } })).toBe(1);
    });

    it('refuses the same key for a different request, and keys are per user', async () => {
      const product = await createProduct({ initialStock: 5 });
      const key = randomUUID();
      const move = (auth: { Authorization: string }, quantity: number) =>
        ctx.http().post(`/api/inventory/${product.id}/movements`).set(auth).set('Idempotency-Key', key).send({ type: 'RECEIPT', quantity });

      await move(admin, 1).expect(201);
      const other = await createProduct({ sku: 'CHA-OTHER-BLK' });
      await ctx
        .http()
        .post(`/api/inventory/${other.id}/movements`)
        .set(admin)
        .set('Idempotency-Key', key)
        .send({ type: 'RECEIPT', quantity: 1 })
        .expect(422);

      const manager = { Authorization: `Bearer ${await signIn(ctx, MANAGER)}` };
      await move(manager, 1).expect(201); // same key, other user: a separate request
      expect(await stock(product.id)).toMatchObject({ onHand: 7 });
    });

    it('lets a failed request be retried with the same key', async () => {
      const product = await createProduct({ initialStock: 1 });
      await ctx.prisma.inventory.update({ where: { productId: product.id }, data: { reserved: 1 } });
      const key = randomUUID();
      const correction = () =>
        ctx
          .http()
          .post(`/api/inventory/${product.id}/movements`)
          .set(admin)
          .set('Idempotency-Key', key)
          .send({ type: 'ADJUSTMENT', quantity: -1 });

      await correction().expect(409);
      await ctx.prisma.inventory.update({ where: { productId: product.id }, data: { reserved: 0 } });
      await correction().expect(201);
    });

    it('rejects a malformed key', async () => {
      const product = await createProduct();
      await ctx
        .http()
        .post(`/api/inventory/${product.id}/movements`)
        .set(admin)
        .set('Idempotency-Key', 'bad key!')
        .send({ type: 'RECEIPT', quantity: 1 })
        .expect(400);
    });
  });
});

import { ADMIN, createTestApp, resetDatabase, sampleProduct, signIn, type TestContext } from './utils.js';

describe('products and stock (e2e)', () => {
  let ctx: TestContext;
  let auth: { Authorization: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    auth = { Authorization: `Bearer ${await signIn(ctx, ADMIN)}` };
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const createProduct = async (overrides: Record<string, unknown> = {}) =>
    (await ctx.http().post('/api/products').set(auth).send(sampleProduct(overrides)).expect(201)).body;

  it('creates a product with its stock and returns money as strings', async () => {
    const product = await createProduct();
    expect(product).toMatchObject({
      sku: 'TAB-TEST-OAK',
      basePrice: '249.99',
      weightKg: '20.500',
      stock: { onHand: 5, reserved: 0, available: 5 },
    });
    const movements = await ctx.http().get(`/api/inventory/${product.id}/movements`).set(auth).expect(200);
    expect(movements.body.items).toEqual([expect.objectContaining({ type: 'RECEIPT', quantity: 5 })]);
  });

  it('rejects invalid bodies and unknown fields', async () => {
    const res = await ctx
      .http()
      .post('/api/products')
      .set(auth)
      .send(sampleProduct({ sku: 'lower case', basePrice: 12.5, ownerId: 1 }))
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        'property ownerId should not exist',
        expect.stringContaining('sku'),
        expect.stringContaining('basePrice'),
      ]),
    );
  });

  it('answers 409 for a duplicate SKU', async () => {
    await createProduct();
    const res = await ctx.http().post('/api/products').set(auth).send(sampleProduct()).expect(409);
    expect(res.body.message).toContain('Already exists');
  });

  it('does not let null into a required column on update', async () => {
    const product = await createProduct();
    await ctx.http().patch(`/api/products/${product.id}`).set(auth).send({ title: null }).expect(400);
  });

  it('answers 404 for a missing product', async () => {
    await ctx.http().get('/api/products/999').set(auth).expect(404);
    await ctx.http().patch('/api/products/999').set(auth).send({ basePrice: '10.00' }).expect(404);
  });

  it('searches by title or SKU and filters low stock', async () => {
    await createProduct({ sku: 'SOF-OSLO-GRY', title: 'Oslo sofa', category: 'sofas', initialStock: 1 });
    await createProduct({ sku: 'CHA-WIRE-BLK', title: 'Wire chair', category: 'chairs', initialStock: 30 });

    const search = await ctx.http().get('/api/products?search=oslo').set(auth).expect(200);
    expect(search.body.items.map((p: { sku: string }) => p.sku)).toEqual(['SOF-OSLO-GRY']);

    const low = await ctx.http().get('/api/products?lowStock=2').set(auth).expect(200);
    expect(low.body.total).toBe(1);
    expect(low.body.items[0].sku).toBe('SOF-OSLO-GRY');
  });

  it('archives instead of deleting', async () => {
    const product = await createProduct();
    await ctx.http().delete(`/api/products/${product.id}`).set(auth).expect(204);
    const res = await ctx.http().get(`/api/products/${product.id}`).set(auth).expect(200);
    expect(res.body.isActive).toBe(false);
  });

  it('never lets stock drop below the reserved quantity', async () => {
    const product = await createProduct({ initialStock: 5 });
    await ctx.prisma.inventory.update({ where: { productId: product.id }, data: { reserved: 3 } });

    const res = await ctx
      .http()
      .post(`/api/inventory/${product.id}/movements`)
      .set(auth)
      .send({ type: 'ADJUSTMENT', quantity: -3 })
      .expect(409);
    expect(res.body.message).toContain('reserved');

    await ctx
      .http()
      .post(`/api/inventory/${product.id}/movements`)
      .set(auth)
      .send({ type: 'ADJUSTMENT', quantity: -2 })
      .expect(201);
  });

  it('keeps stock consistent under 20 concurrent write-offs of 1 unit with 5 in stock', async () => {
    const product = await createProduct({ initialStock: 5 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        ctx
          .http()
          .post(`/api/inventory/${product.id}/movements`)
          .set(auth)
          .send({ type: 'ADJUSTMENT', quantity: -1, reason: 'damaged' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(15);

    const stock = await ctx.http().get(`/api/inventory/${product.id}`).set(auth).expect(200);
    expect(stock.body).toEqual({ onHand: 0, reserved: 0, available: 0 });
  });

  it('lists a product on every enabled marketplace, and listing it again changes nothing', async () => {
    const product = await createProduct();
    const first = await ctx.http().post('/api/listings').set(auth).send({ productId: product.id }).expect(201);
    expect(first.body.map((l: { marketplace: string }) => l.marketplace)).toEqual(['amazon', 'ebay', 'otto']);

    const again = await ctx.http().post('/api/listings').set(auth).send({ productId: product.id }).expect(201);
    expect(again.body).toHaveLength(3);

    // Kaufland is disabled in the test data.
    await ctx.http().post('/api/listings').set(auth).send({ productId: product.id, marketplaceIds: [4] }).expect(400);
  });

  it('writes an audit row for each change', async () => {
    const product = await createProduct();
    await ctx.http().patch(`/api/products/${product.id}`).set(auth).send({ basePrice: '199.00' }).expect(200);
    // The audit write does not block the response; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rows = await ctx.prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['POST /api/products', 'PATCH /api/products/:id']);
  });
});

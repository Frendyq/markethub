import { PricingClient, type FeedReport } from '../src/pricing/pricing.client.js';
import { ADMIN, createTestApp, resetDatabase, sampleProduct, signIn, type TestContext } from './utils.js';

// The CSV checks themselves are tested in the Rust service; here the pricing-engine answer is fixed.
const report: FeedReport = {
  totalRows: 3,
  validRows: 2,
  errorRows: 1,
  rows: [
    { line: 2, sku: 'TAB-TEST-OAK', title: 'Test table, oak (new)', category: 'tables', costPrice: '110.00', basePrice: '259.00', weightKg: '20.500', widthCm: 120, heightCm: 75, depthCm: 70, ean: null, stock: 4 },
    { line: 3, sku: 'CHA-NEW-BLK', title: 'New chair', category: 'chairs', costPrice: '20.00', basePrice: '49.00', weightKg: '6.000', widthCm: 48, heightCm: 85, depthCm: 52, ean: '4006381333931', stock: null },
  ],
  errors: [{ line: 4, sku: 'X', field: 'sku', message: '3-40 characters' }],
};

describe('price list import (e2e)', () => {
  let ctx: TestContext;
  let auth: { Authorization: string };
  const validateFeed = vi.fn(async () => report);

  beforeAll(async () => {
    ctx = await createTestApp((builder) => builder.overrideProvider(PricingClient).useValue({ validateFeed, calculate: vi.fn() }));
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    auth = { Authorization: `Bearer ${await signIn(ctx, ADMIN)}` };
    await ctx.http().post('/api/products').set(auth).send(sampleProduct({ initialStock: 1 })).expect(201);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const post = (query = '') =>
    ctx.http().post(`/api/feeds/import${query}`).set(auth).set('content-type', 'text/csv').send('sku,title\n...');

  it('changes nothing on a dry run', async () => {
    const res = await post('?dryRun=true').expect(200);
    expect(res.body).toMatchObject({ dryRun: true, validRows: 2, errorRows: 1, created: 0, updated: 0 });
    expect(await ctx.prisma.product.count()).toBe(1);
    expect(validateFeed).toHaveBeenCalledWith('sku,title\n...');
  });

  it('updates existing products, creates new ones and books delivered stock', async () => {
    const res = await post().expect(200);
    expect(res.body).toMatchObject({ created: 1, updated: 1, errors: [expect.objectContaining({ line: 4 })] });

    const updated = await ctx.prisma.product.findUniqueOrThrow({ where: { sku: 'TAB-TEST-OAK' }, include: { inventory: true } });
    expect(updated.title).toBe('Test table, oak (new)');
    expect(updated.basePrice.toFixed(2)).toBe('259.00');
    expect(updated.inventory?.onHand).toBe(5);

    const created = await ctx.prisma.product.findUniqueOrThrow({ where: { sku: 'CHA-NEW-BLK' }, include: { inventory: true } });
    expect(created.inventory?.onHand).toBe(0);
  });

  it('asks for a CSV body', async () => {
    await ctx.http().post('/api/feeds/import').set(auth).send({ not: 'csv' }).expect(400);
  });
});

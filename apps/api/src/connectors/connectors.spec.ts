import { AmazonConnector, EbayConnector, KauflandConnector, OttoConnector } from './connectors.js';
import { PermanentMarketplaceError, RateLimitedError, TransientMarketplaceError } from './connector.types.js';
import { fromCents, toCents } from './marketplace-http.js';

const http = { baseUrl: 'http://mock', apiKey: 'key' };
const when = '2026-11-24T10:00:00.000Z';

describe('marketplace connectors', () => {
  it('read four different order formats into the same order', () => {
    const expected = {
      externalId: 'X-1',
      placedAt: new Date(when),
      currency: 'EUR',
      total: '599.98',
      customerName: 'Anna',
      items: [{ sku: 'TAB-A', quantity: 2, unitPrice: '299.99' }],
    };

    const amazon = new AmazonConnector(http).parseOrder({
      AmazonOrderId: 'X-1',
      PurchaseDate: when,
      BuyerName: 'Anna',
      OrderTotal: { Amount: '599.98', CurrencyCode: 'EUR' },
      OrderItems: [{ SellerSKU: 'TAB-A', QuantityOrdered: 2, ItemPrice: { Amount: '299.99' } }],
    });
    const ebay = new EbayConnector(http).parseOrder({
      orderId: 'X-1',
      creationDate: when,
      buyer: { username: 'Anna' },
      pricingSummary: { total: { value: '599.98', currency: 'EUR' } },
      lineItems: [{ sku: 'TAB-A', quantity: 2, lineItemCost: { value: '599.98' } }],
    });
    const otto = new OttoConnector(http).parseOrder({
      salesOrderId: 'X-1',
      orderDate: when,
      buyerName: 'Anna',
      positionItems: [
        { product: { sku: 'TAB-A' }, itemValueGrossPrice: { amount: '299.99', currency: 'EUR' } },
        { product: { sku: 'TAB-A' }, itemValueGrossPrice: { amount: '299.99', currency: 'EUR' } },
      ],
    });
    const kaufland = new KauflandConnector(http).parseOrder({
      id_order: 'X-1',
      ts_created_iso: when,
      buyer: { name: 'Anna' },
      currency: 'EUR',
      order_units: [
        { id_offer: 'TAB-A', price: 29999 },
        { id_offer: 'TAB-A', price: 29999 },
      ],
    });

    for (const order of [amazon, ebay, otto, kaufland]) {
      expect(order).toEqual(expected);
    }
  });

  it('refuses an order with missing fields instead of guessing', () => {
    expect(() => new AmazonConnector(http).parseOrder({ AmazonOrderId: 'X' })).toThrow(PermanentMarketplaceError);
  });

  it('converts money to cents and back without floating point errors', () => {
    expect(toCents('1283.99')).toBe(128399);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('12')).toBe(1200);
    expect(fromCents(128399)).toBe('1283.99');
    expect(fromCents(5)).toBe('0.05');
  });

  describe('HTTP errors', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const answer = (status: number, body = '{}', headers: Record<string, string> = {}) =>
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status, headers })));

    const push = () =>
      new KauflandConnector(http).pushListing({ sku: 'A', title: 'A', ean: null, price: '10.00', currency: 'EUR', quantity: 1 });

    it('turns 429 into a rate limit with the Retry-After delay', async () => {
      answer(429, '{}', { 'retry-after': '3' });
      await expect(push()).rejects.toMatchObject({ constructor: RateLimitedError, retryAfterMs: 3000 });
    });

    it('treats 5xx and network errors as transient', async () => {
      answer(503);
      await expect(push()).rejects.toBeInstanceOf(TransientMarketplaceError);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
      await expect(push()).rejects.toBeInstanceOf(TransientMarketplaceError);
    });

    it('treats other 4xx as permanent', async () => {
      answer(400, '{"error":"bad"}');
      await expect(push()).rejects.toBeInstanceOf(PermanentMarketplaceError);
    });

    it('sends Kaufland prices as integer cents', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":{"id_unit":"U1"}}', { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(push()).resolves.toEqual({ externalId: 'U1' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.listing_price).toBe(1000);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { renderOrder, renderOrderList } from './formats.js';
import type { StoredOrder } from './store.js';

const order = (marketplace: StoredOrder['marketplace']): StoredOrder => ({
  id: 'X-1',
  marketplace,
  createdAt: '2026-11-24T10:00:00.000Z',
  buyerName: 'Anna',
  currency: 'EUR',
  items: [{ sku: 'TAB-A', quantity: 2, unitPriceCents: 29999 }],
});

describe('marketplace order formats', () => {
  it('Amazon: decimal strings and an order total', () => {
    expect(renderOrder(order('amazon'))).toMatchObject({
      AmazonOrderId: 'X-1',
      OrderTotal: { Amount: '599.98', CurrencyCode: 'EUR' },
      OrderItems: [{ SellerSKU: 'TAB-A', QuantityOrdered: 2, ItemPrice: { Amount: '299.99' } }],
    });
  });

  it('OTTO: one position per unit', () => {
    const rendered = renderOrder(order('otto')) as { positionItems: unknown[] };
    expect(rendered.positionItems).toHaveLength(2);
  });

  it('Kaufland: one unit per entry, prices in cents', () => {
    expect(renderOrder(order('kaufland'))).toMatchObject({
      id_order: 'X-1',
      order_units: [
        { id_offer: 'TAB-A', price: 29999 },
        { id_offer: 'TAB-A', price: 29999 },
      ],
    });
  });

  it('wraps lists the way each marketplace does', () => {
    expect(renderOrderList('amazon', [])).toEqual({ payload: { Orders: [] } });
    expect(renderOrderList('otto', [])).toEqual({ resources: [] });
    expect(renderOrderList('kaufland', [])).toEqual({ data: [] });
  });
});

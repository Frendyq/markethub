import type { MarketplaceCode } from './config.js';
import type { StoredOrder } from './store.js';

/**
 * Each marketplace returns orders in its own shape, loosely modelled on the real APIs
 * (Amazon SP-API, eBay Fulfillment API, OTTO Market API, Kaufland Seller API).
 * The MarketHub adapters have to translate all four.
 */
const amount = (cents: number) => (cents / 100).toFixed(2);
const totalCents = (order: StoredOrder) => order.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);

export function renderOrder(order: StoredOrder): unknown {
  switch (order.marketplace) {
    case 'amazon':
      return {
        AmazonOrderId: order.id,
        PurchaseDate: order.createdAt,
        BuyerName: order.buyerName,
        OrderTotal: { Amount: amount(totalCents(order)), CurrencyCode: order.currency },
        OrderItems: order.items.map((i) => ({
          SellerSKU: i.sku,
          QuantityOrdered: i.quantity,
          ItemPrice: { Amount: amount(i.unitPriceCents), CurrencyCode: order.currency },
        })),
      };
    case 'ebay':
      return {
        orderId: order.id,
        creationDate: order.createdAt,
        buyer: { username: order.buyerName },
        pricingSummary: { total: { value: amount(totalCents(order)), currency: order.currency } },
        lineItems: order.items.map((i) => ({
          sku: i.sku,
          quantity: i.quantity,
          lineItemCost: { value: amount(i.unitPriceCents * i.quantity), currency: order.currency },
        })),
      };
    case 'otto':
      // OTTO lists every unit as its own position.
      return {
        salesOrderId: order.id,
        orderDate: order.createdAt,
        buyerName: order.buyerName,
        positionItems: order.items.flatMap((i) =>
          Array.from({ length: i.quantity }, () => ({
            product: { sku: i.sku },
            itemValueGrossPrice: { amount: amount(i.unitPriceCents), currency: order.currency },
          })),
        ),
      };
    case 'kaufland':
      // Kaufland: one unit per entry and prices in cents.
      return {
        id_order: order.id,
        ts_created_iso: order.createdAt,
        buyer: { name: order.buyerName },
        currency: order.currency,
        order_units: order.items.flatMap((i) =>
          Array.from({ length: i.quantity }, () => ({ id_offer: i.sku, price: i.unitPriceCents })),
        ),
      };
  }
}

export function renderOrderList(marketplace: MarketplaceCode, orders: StoredOrder[]): unknown {
  const rendered = orders.map(renderOrder);
  switch (marketplace) {
    case 'amazon':
      return { payload: { Orders: rendered } };
    case 'ebay':
      return { orders: rendered, total: rendered.length };
    case 'otto':
      return { resources: rendered };
    case 'kaufland':
      return { data: rendered };
  }
}

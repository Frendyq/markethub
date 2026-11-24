import {
  PermanentMarketplaceError,
  type ExternalOrder,
  type ListingPush,
  type MarketplaceConnector,
} from './connector.types.js';
import { fromCents, marketplaceRequest, required, toCents, type HttpOptions } from './marketplace-http.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- marketplace payloads are untyped JSON we validate field by field */

/** Sums unit prices given as decimal strings without floats. */
function sumCents(items: { quantity: number; unitPrice: string }[]): string {
  return fromCents(items.reduce((sum, item) => sum + toCents(item.unitPrice) * item.quantity, 0));
}

/** Collapses "one entry per unit" formats (OTTO, Kaufland) into one line per SKU. */
function groupUnits(units: { sku: string; unitPrice: string }[]): ExternalOrder['items'] {
  const bySku = new Map<string, ExternalOrder['items'][number]>();
  for (const unit of units) {
    const line = bySku.get(unit.sku);
    if (line) {
      line.quantity += 1;
    } else {
      bySku.set(unit.sku, { sku: unit.sku, quantity: 1, unitPrice: unit.unitPrice });
    }
  }
  return [...bySku.values()];
}

function asArray(value: unknown, what: string): any[] {
  if (!Array.isArray(value)) {
    throw new PermanentMarketplaceError(`unexpected marketplace response: ${what} is not a list`);
  }
  return value;
}

export class AmazonConnector implements MarketplaceConnector {
  readonly code = 'amazon';
  constructor(private readonly http: HttpOptions) {}

  async pushListing(l: ListingPush): Promise<{ externalId: string }> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'PUT', `/amazon/listings/${encodeURIComponent(l.sku)}`, {
      productType: 'FURNITURE',
      attributes: {
        item_name: [{ value: l.title }],
        externally_assigned_product_identifier: l.ean ? [{ type: 'ean', value: l.ean }] : undefined,
        list_price: [{ value: l.price, currency: l.currency }],
        fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: l.quantity }],
      },
    });
    return { externalId: required(res.asin, 'asin') };
  }

  async fetchOrders(since: Date): Promise<ExternalOrder[]> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'GET', `/amazon/orders?CreatedAfter=${since.toISOString()}`);
    return asArray(res?.payload?.Orders, 'payload.Orders').map((o) => this.parseOrder(o));
  }

  parseOrder(o: any): ExternalOrder {
    return {
      externalId: required(o?.AmazonOrderId, 'AmazonOrderId'),
      placedAt: new Date(required(o.PurchaseDate, 'PurchaseDate')),
      currency: required(o.OrderTotal?.CurrencyCode, 'OrderTotal.CurrencyCode'),
      total: required(o.OrderTotal?.Amount, 'OrderTotal.Amount'),
      customerName: o.BuyerName ?? null,
      items: asArray(o.OrderItems, 'OrderItems').map((i) => ({
        sku: required(i.SellerSKU, 'SellerSKU'),
        quantity: Number(required(i.QuantityOrdered, 'QuantityOrdered')),
        unitPrice: required(i.ItemPrice?.Amount, 'ItemPrice.Amount'),
      })),
    };
  }
}

export class EbayConnector implements MarketplaceConnector {
  readonly code = 'ebay';
  constructor(private readonly http: HttpOptions) {}

  async pushListing(l: ListingPush): Promise<{ externalId: string }> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'PUT', `/ebay/inventory_item/${encodeURIComponent(l.sku)}`, {
      product: { title: l.title, ean: l.ean ? [l.ean] : [] },
      availability: { shipToLocationAvailability: { quantity: l.quantity } },
      offer: { pricingSummary: { price: { value: l.price, currency: l.currency } } },
    });
    return { externalId: required(res.offerId, 'offerId') };
  }

  async fetchOrders(since: Date): Promise<ExternalOrder[]> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'GET', `/ebay/orders?creationdate_from=${since.toISOString()}`);
    return asArray(res?.orders, 'orders').map((o) => this.parseOrder(o));
  }

  parseOrder(o: any): ExternalOrder {
    const items = asArray(o?.lineItems, 'lineItems').map((i) => {
      const quantity = Number(required(i.quantity, 'quantity'));
      // eBay gives the line total; we store the unit price.
      const lineCents = toCents(required(i.lineItemCost?.value, 'lineItemCost.value'));
      return { sku: required(i.sku, 'sku'), quantity, unitPrice: fromCents(Math.round(lineCents / quantity)) };
    });
    return {
      externalId: required(o.orderId, 'orderId'),
      placedAt: new Date(required(o.creationDate, 'creationDate')),
      currency: required(o.pricingSummary?.total?.currency, 'pricingSummary.total.currency'),
      total: required(o.pricingSummary?.total?.value, 'pricingSummary.total.value'),
      customerName: o.buyer?.username ?? null,
      items,
    };
  }
}

export class OttoConnector implements MarketplaceConnector {
  readonly code = 'otto';
  constructor(private readonly http: HttpOptions) {}

  async pushListing(l: ListingPush): Promise<{ externalId: string }> {
    // OTTO takes batches; we send a batch of one and read our result from it.
    const res = await marketplaceRequest<any>(this.code, this.http, 'POST', '/otto/products', [
      {
        sku: l.sku,
        ean: l.ean,
        productTitle: l.title,
        pricing: { standardPrice: { amount: l.price, currency: l.currency } },
        quantity: l.quantity,
      },
    ]);
    const result = asArray(res?.results, 'results').find((r) => r?.sku === l.sku);
    if (!result || result.state !== 'DONE') {
      throw new PermanentMarketplaceError(`otto rejected ${l.sku}: ${result?.message ?? 'no result'}`);
    }
    return { externalId: required(result.productReference, 'productReference') };
  }

  async fetchOrders(since: Date): Promise<ExternalOrder[]> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'GET', `/otto/orders?fromOrderDate=${since.toISOString()}`);
    return asArray(res?.resources, 'resources').map((o) => this.parseOrder(o));
  }

  parseOrder(o: any): ExternalOrder {
    const positions = asArray(o?.positionItems, 'positionItems');
    const items = groupUnits(
      positions.map((p) => ({
        sku: required(p.product?.sku, 'product.sku'),
        unitPrice: required(p.itemValueGrossPrice?.amount, 'itemValueGrossPrice.amount'),
      })),
    );
    return {
      externalId: required(o.salesOrderId, 'salesOrderId'),
      placedAt: new Date(required(o.orderDate, 'orderDate')),
      currency: required(positions[0]?.itemValueGrossPrice?.currency, 'itemValueGrossPrice.currency'),
      total: sumCents(items),
      customerName: o.buyerName ?? null,
      items,
    };
  }
}

export class KauflandConnector implements MarketplaceConnector {
  readonly code = 'kaufland';
  constructor(private readonly http: HttpOptions) {}

  async pushListing(l: ListingPush): Promise<{ externalId: string }> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'POST', '/kaufland/units', {
      id_offer: l.sku,
      ean: l.ean,
      title: l.title,
      listing_price: toCents(l.price), // Kaufland wants integer cents
      currency: l.currency,
      amount: l.quantity,
    });
    return { externalId: required(res?.data?.id_unit, 'data.id_unit') };
  }

  async fetchOrders(since: Date): Promise<ExternalOrder[]> {
    const res = await marketplaceRequest<any>(this.code, this.http, 'GET', `/kaufland/orders?ts_created_from_iso=${since.toISOString()}`);
    return asArray(res?.data, 'data').map((o) => this.parseOrder(o));
  }

  parseOrder(o: any): ExternalOrder {
    const items = groupUnits(
      asArray(o?.order_units, 'order_units').map((u) => ({
        sku: required(u.id_offer, 'id_offer'),
        unitPrice: fromCents(Number(required(u.price, 'price'))),
      })),
    );
    return {
      externalId: String(required(o.id_order, 'id_order')),
      placedAt: new Date(required(o.ts_created_iso, 'ts_created_iso')),
      currency: o.currency ?? 'EUR',
      total: sumCents(items),
      customerName: o.buyer?.name ?? null,
      items,
    };
  }
}

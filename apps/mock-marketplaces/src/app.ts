import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { chaos, marketplaceChaos } from './chaos.js';
import { MARKETPLACES, type MarketplaceCode } from './config.js';
import { renderOrderList } from './formats.js';
import { store, type StoredOrder } from './store.js';
import { deliverOrderWebhook } from './webhooks.js';

const BUYERS = ['Anna Schmidt', 'Lukas Weber', 'Emily Clark', 'Jonas Becker', 'Mia Fischer', 'Noah Miller'];
const cents = (value: unknown) => Math.round(Number(value) * 100);
const since = (value: unknown) => (typeof value === 'string' && value ? new Date(value) : new Date(0));

function bad(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, _res, next) => {
    store.countRequest();
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ---- Amazon: one listing per PUT, prices as decimals in nested arrays --------------------------
  app.put('/amazon/listings/:sku', marketplaceChaos('amazon'), (req: Request, res: Response) => {
    const attrs = req.body?.attributes;
    const price = attrs?.list_price?.[0];
    const quantity = attrs?.fulfillment_availability?.[0]?.quantity;
    if (!attrs?.item_name?.[0]?.value || !price?.value || !Number.isInteger(quantity)) {
      return bad(res, 'attributes.item_name, list_price and fulfillment_availability are required');
    }
    const listing = store.upsertListing('amazon', {
      sku: String(req.params.sku),
      title: attrs.item_name[0].value,
      priceCents: cents(price.value),
      currency: price.currency ?? 'EUR',
      quantity,
    });
    res.json({ sku: listing.sku, status: 'ACCEPTED', submissionId: randomUUID(), asin: listing.externalId });
  });
  app.get('/amazon/orders', marketplaceChaos('amazon'), (req, res) => {
    res.json(renderOrderList('amazon', store.ordersSince('amazon', since(req.query.CreatedAfter))));
  });

  // ---- eBay: inventory item with an offer -------------------------------------------------------
  app.put('/ebay/inventory_item/:sku', marketplaceChaos('ebay'), (req, res) => {
    const price = req.body?.offer?.pricingSummary?.price;
    const quantity = req.body?.availability?.shipToLocationAvailability?.quantity;
    if (!req.body?.product?.title || !price?.value || !Number.isInteger(quantity)) {
      return bad(res, 'product.title, availability and offer.pricingSummary.price are required');
    }
    const listing = store.upsertListing('ebay', {
      sku: String(req.params.sku),
      title: req.body.product.title,
      priceCents: cents(price.value),
      currency: price.currency ?? 'USD',
      quantity,
    });
    res.json({ sku: listing.sku, offerId: listing.externalId });
  });
  app.get('/ebay/orders', marketplaceChaos('ebay'), (req, res) => {
    res.json(renderOrderList('ebay', store.ordersSince('ebay', since(req.query.creationdate_from))));
  });

  // ---- OTTO: products are sent in batches -------------------------------------------------------
  app.post('/otto/products', marketplaceChaos('otto'), (req, res) => {
    if (!Array.isArray(req.body) || req.body.length === 0 || req.body.length > 100) {
      return bad(res, 'body must be an array of 1-100 products');
    }
    const results = req.body.map((p: Record<string, any>) => {
      if (!p?.sku || !p.productTitle || !p.pricing?.standardPrice?.amount || !Number.isInteger(p.quantity)) {
        return { sku: p?.sku ?? null, state: 'ERROR', message: 'sku, productTitle, pricing.standardPrice and quantity are required' };
      }
      const listing = store.upsertListing('otto', {
        sku: p.sku,
        title: p.productTitle,
        priceCents: cents(p.pricing.standardPrice.amount),
        currency: p.pricing.standardPrice.currency ?? 'EUR',
        quantity: p.quantity,
      });
      return { sku: p.sku, state: 'DONE', productReference: listing.externalId };
    });
    res.json({ results });
  });
  app.get('/otto/orders', marketplaceChaos('otto'), (req, res) => {
    res.json(renderOrderList('otto', store.ordersSince('otto', since(req.query.fromOrderDate))));
  });

  // ---- Kaufland: units, prices in cents ---------------------------------------------------------
  app.post('/kaufland/units', marketplaceChaos('kaufland'), (req, res) => {
    const b = req.body ?? {};
    if (!b.id_offer || !b.title || !Number.isInteger(b.listing_price) || !Number.isInteger(b.amount)) {
      return bad(res, 'id_offer, title, listing_price (integer cents) and amount are required');
    }
    const listing = store.upsertListing('kaufland', {
      sku: b.id_offer,
      title: b.title,
      priceCents: b.listing_price,
      currency: b.currency ?? 'EUR',
      quantity: b.amount,
    });
    res.status(201).json({ data: { id_unit: listing.externalId } });
  });
  app.get('/kaufland/orders', marketplaceChaos('kaufland'), (req, res) => {
    res.json(renderOrderList('kaufland', store.ordersSince('kaufland', since(req.query.ts_created_from_iso))));
  });

  // ---- Admin: not part of any marketplace, used by demos and tests -------------------------------
  app.get('/_admin/state', (_req, res) => {
    res.json({ chaos, ...store.state() });
  });

  app.post('/_admin/chaos', (req, res) => {
    const { failRate, minLatencyMs, maxLatencyMs, rateLimits, autoOrders } = req.body ?? {};
    if (typeof autoOrders === 'boolean') chaos.autoOrders = autoOrders;
    if (typeof failRate === 'number') chaos.failRate = failRate;
    if (typeof minLatencyMs === 'number') chaos.minLatencyMs = minLatencyMs;
    if (typeof maxLatencyMs === 'number') chaos.maxLatencyMs = maxLatencyMs;
    if (rateLimits && typeof rateLimits === 'object') Object.assign(chaos.rateLimits, rateLimits);
    res.json(chaos);
  });

  app.post('/_admin/reset', (_req, res) => {
    store.reset();
    res.status(204).end();
  });

  /** Creates an order. delivery: "webhook" (default) sends it to MarketHub, "poll" waits to be pulled. */
  app.post('/_admin/orders', async (req, res) => {
    const { marketplace, sku, quantity = 1, delivery = 'webhook' } = req.body ?? {};
    if (!(MARKETPLACES as readonly string[]).includes(marketplace)) {
      return bad(res, `marketplace must be one of ${MARKETPLACES.join(', ')}`);
    }
    const order = createOrder(marketplace as MarketplaceCode, sku, Number(quantity));
    if (!order) {
      return bad(res, 'no such listing on this marketplace (push it first)');
    }
    if (delivery === 'webhook') {
      await deliverOrderWebhook(order);
    }
    res.status(201).json(order);
  });

  return app;
}

export function createOrder(marketplace: MarketplaceCode, sku?: string, quantity = 1): StoredOrder | undefined {
  const candidates = store.listings(marketplace).filter((l) => (sku ? l.sku === sku : l.quantity > 0));
  const listing = candidates[Math.floor(Math.random() * candidates.length)];
  if (!listing) {
    return undefined;
  }
  const order: StoredOrder = {
    id: `${marketplace.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    marketplace,
    createdAt: new Date().toISOString(),
    buyerName: BUYERS[Math.floor(Math.random() * BUYERS.length)],
    currency: listing.currency,
    items: [{ sku: listing.sku, quantity, unitPriceCents: listing.priceCents }],
  };
  store.addOrder(order);
  return order;
}

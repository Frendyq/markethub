export const MARKETPLACES = ['amazon', 'ebay', 'otto', 'kaufland'] as const;
export type MarketplaceCode = (typeof MARKETPLACES)[number];

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function rateLimits(raw: string | undefined): Record<MarketplaceCode, number> {
  const limits: Record<MarketplaceCode, number> = { amazon: 5, ebay: 4, otto: 3, kaufland: 3 };
  for (const pair of (raw ?? '').split(',').filter(Boolean)) {
    const [code, value] = pair.split(':');
    if ((MARKETPLACES as readonly string[]).includes(code)) {
      limits[code as MarketplaceCode] = Number(value);
    }
  }
  return limits;
}

export const config = {
  port: num('PORT', 3002),
  apiUrl: (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret',
  apiKey: process.env.MARKETPLACE_API_KEY ?? 'mock-key',
  /** Share of API calls answered with 500/503. */
  failRate: num('FAIL_RATE', 0.15),
  minLatencyMs: num('MIN_LATENCY_MS', 30),
  maxLatencyMs: num('MAX_LATENCY_MS', 250),
  /** A random order every N ms on a random marketplace. 0 turns it off. */
  orderIntervalMs: num('ORDER_INTERVAL_MS', 30_000),
  /** Share of webhooks delivered twice, like real marketplaces do on retries. */
  duplicateWebhookRate: num('DUPLICATE_WEBHOOK_RATE', 0.3),
  rateLimits: rateLimits(process.env.RATE_LIMITS),
};

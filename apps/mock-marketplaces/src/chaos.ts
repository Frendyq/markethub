import type { NextFunction, Request, Response } from 'express';
import { config, type MarketplaceCode } from './config.js';

/** Runtime knobs, changeable through POST /_admin/chaos (tests and demos turn errors off). */
export const chaos = {
  failRate: config.failRate,
  minLatencyMs: config.minLatencyMs,
  maxLatencyMs: config.maxLatencyMs,
  rateLimits: { ...config.rateLimits },
  /** Random customer orders every ORDER_INTERVAL_MS; tests switch them off. */
  autoOrders: config.orderIntervalMs > 0,
};

const windows = new Map<MarketplaceCode, { second: number; count: number }>();

/**
 * Makes a marketplace route behave like a real third-party API:
 * API key check, random latency, a per-second rate limit (429 + Retry-After) and random 5xx errors.
 */
export function marketplaceChaos(marketplace: MarketplaceCode) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.header('x-api-key') !== config.apiKey) {
      res.status(401).json({ error: 'invalid api key' });
      return;
    }

    const second = Math.floor(Date.now() / 1000);
    const window = windows.get(marketplace);
    const current = window && window.second === second ? window : { second, count: 0 };
    current.count += 1;
    windows.set(marketplace, current);
    if (current.count > chaos.rateLimits[marketplace]) {
      res.setHeader('Retry-After', '1');
      res.status(429).json({ error: 'rate limit exceeded', limitPerSecond: chaos.rateLimits[marketplace] });
      return;
    }

    const delay = chaos.minLatencyMs + Math.random() * Math.max(0, chaos.maxLatencyMs - chaos.minLatencyMs);
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (Math.random() < chaos.failRate) {
      const status = Math.random() < 0.5 ? 500 : 503;
      res.status(status).json({ error: status === 500 ? 'internal error' : 'service unavailable' });
      return;
    }
    next();
  };
}

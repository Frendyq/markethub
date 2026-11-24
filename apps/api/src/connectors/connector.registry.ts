import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { MarketplaceConnector } from './connector.types.js';
import { AmazonConnector, EbayConnector, KauflandConnector, OttoConnector } from './connectors.js';

export const MARKETPLACE_CODES = ['amazon', 'ebay', 'otto', 'kaufland'] as const;
export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

/** Finds the connector of a marketplace by its code. */
@Injectable()
export class ConnectorRegistry {
  private readonly connectors: Map<string, MarketplaceConnector>;

  constructor(config: ConfigService<Env, true>) {
    const http = {
      baseUrl: config.get('MARKETPLACES_URL', { infer: true }).replace(/\/$/, ''),
      apiKey: config.get('MARKETPLACE_API_KEY', { infer: true }),
    };
    this.connectors = new Map<string, MarketplaceConnector>(
      [new AmazonConnector(http), new EbayConnector(http), new OttoConnector(http), new KauflandConnector(http)].map((c) => [
        c.code,
        c,
      ]),
    );
  }

  get(code: string): MarketplaceConnector {
    const connector = this.connectors.get(code);
    if (!connector) {
      throw new NotFoundException(`No connector for marketplace "${code}"`);
    }
    return connector;
  }

  has(code: string): boolean {
    return this.connectors.has(code);
  }
}

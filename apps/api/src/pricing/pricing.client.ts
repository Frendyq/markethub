import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export interface PriceItem {
  sku: string;
  basePrice: string;
  costPrice: string;
}

export interface PriceQuote {
  sku: string;
  price: string;
  currency: string;
  vatAmount: string;
  feeAmount: string;
  proceeds: string;
  proceedsEur: string;
  marginEur: string;
  marginPercent: string;
  belowMinMargin: boolean;
}

export interface CalculateResponse {
  marketplace: string;
  currency: string;
  minMarginPercent: string;
  items: PriceQuote[];
}

export interface FeedRow {
  line: number;
  sku: string;
  title: string;
  category: string;
  costPrice: string;
  basePrice: string;
  weightKg: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  ean: string | null;
  stock: number | null;
}

export interface FeedReport {
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: FeedRow[];
  errors: { line: number; sku: string | null; field: string; message: string }[];
}

const TIMEOUT_MS = 5_000;
const ATTEMPTS = 2;

/**
 * HTTP client of the Rust pricing-engine.
 * Both calls are pure computations, so retrying them is safe.
 * 4xx answers are the caller's fault and are not retried.
 */
@Injectable()
export class PricingClient {
  private readonly logger = new Logger(PricingClient.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('PRICING_ENGINE_URL', { infer: true }).replace(/\/$/, '');
  }

  calculate(marketplace: string, items: PriceItem[]): Promise<CalculateResponse> {
    return this.post<CalculateResponse>('/prices/calculate', JSON.stringify({ marketplace, items }), 'application/json');
  }

  validateFeed(csv: string): Promise<FeedReport> {
    return this.post<FeedReport>('/feeds/validate', csv, 'text/csv', 60_000);
  }

  private async post<T>(path: string, body: string, contentType: string, timeoutMs = TIMEOUT_MS): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': contentType },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
          return (await response.json()) as T;
        }
        const detail = (await response.json().catch(() => ({}))) as { message?: string };
        if (response.status < 500) {
          throw new UnprocessableEntityException(detail.message ?? `pricing-engine answered ${response.status}`);
        }
        lastError = new Error(`pricing-engine answered ${response.status}`);
      } catch (error) {
        if (error instanceof UnprocessableEntityException) {
          throw error;
        }
        lastError = error;
      }
      if (attempt < ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
    this.logger.error(`pricing-engine ${path} failed: ${String(lastError)}`);
    throw new ServiceUnavailableException('Pricing engine is unavailable');
  }
}

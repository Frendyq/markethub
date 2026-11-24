import { PermanentMarketplaceError, RateLimitedError, TransientMarketplaceError } from './connector.types.js';

export interface HttpOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

/**
 * HTTP call to a marketplace that classifies every failure, so the queue knows what to do:
 * 429 -> RateLimitedError (wait), 5xx/timeout -> TransientMarketplaceError (retry with backoff),
 * other 4xx -> PermanentMarketplaceError (stop, a human has to look).
 */
export async function marketplaceRequest<T>(
  marketplace: string,
  options: HttpOptions,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${options.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    throw new TransientMarketplaceError(`${marketplace}: ${method} ${path} failed: ${String(error)}`);
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RateLimitedError(marketplace, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000);
  }
  if (response.status >= 500) {
    throw new TransientMarketplaceError(`${marketplace}: ${method} ${path} answered ${response.status}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new PermanentMarketplaceError(`${marketplace}: ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new PermanentMarketplaceError(`${marketplace}: ${method} ${path} returned invalid JSON`);
  }
}

/** Throws a PermanentMarketplaceError when a field we rely on is missing. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined || value === '') {
    throw new PermanentMarketplaceError(`unexpected marketplace response: ${what} is missing`);
  }
  return value;
}

/** "1283.99" -> 128399 without floating point surprises. */
export function toCents(decimal: string): number {
  const [whole, fraction = ''] = decimal.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

/** 128399 -> "1283.99" */
export function fromCents(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;
}

import { PermanentMarketplaceError, RateLimitedError, TransientMarketplaceError } from '../connectors/connector.types.js';
import { classifyFailure } from './sync.jobs.js';

describe('classifyFailure', () => {
  it('waits on a rate limit for as long as the marketplace asked', () => {
    expect(classifyFailure(new RateLimitedError('otto', 3000))).toEqual({ kind: 'rate-limit', delayMs: 3000 });
  });

  it('gives up on errors that a retry cannot fix', () => {
    expect(classifyFailure(new PermanentMarketplaceError('400 bad title'))).toEqual({ kind: 'give-up', message: '400 bad title' });
  });

  it('retries everything else: 5xx, timeouts, our own pricing-engine being down', () => {
    expect(classifyFailure(new TransientMarketplaceError('503'))).toEqual({ kind: 'retry' });
    expect(classifyFailure(new Error('pricing-engine unavailable'))).toEqual({ kind: 'retry' });
  });
});

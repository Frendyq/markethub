import { describe, expect, it } from 'vitest';
import { marketplaceName, money } from './format';

describe('money', () => {
  it('groups thousands and keeps two decimals without turning the string into a float', () => {
    expect(money('1283.99', 'EUR')).toBe('€1,283.99');
    expect(money('1234567.5', 'USD')).toBe('$1,234,567.50');
    expect(money('0.1', 'EUR')).toBe('€0.10');
  });

  it('shows unknown currencies by code and a dash for missing amounts', () => {
    expect(money('10.00', 'PLN')).toBe('PLN 10.00');
    expect(money(null)).toBe('—');
  });
});

describe('marketplaceName', () => {
  it('turns codes into names', () => {
    expect(marketplaceName('ebay')).toBe('eBay');
    expect(marketplaceName('otto')).toBe('OTTO');
    expect(marketplaceName('unknown')).toBe('unknown');
    expect(marketplaceName(null)).toBe('—');
  });
});

import { decimal, money } from './money.js';

describe('money', () => {
  it('formats with two decimals without float rounding errors', () => {
    expect(money(decimal('0.1').plus(decimal('0.2')))).toBe('0.30');
    expect(money(decimal('1299.9'))).toBe('1299.90');
  });

  it('keeps null as null', () => {
    expect(money(null)).toBeNull();
  });
});

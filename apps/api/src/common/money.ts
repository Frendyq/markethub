import { Prisma } from '../generated/prisma/client.js';

/**
 * Money leaves the API as a string with two decimals ("1299.00").
 * JavaScript numbers can't hold every decimal exactly, so we never turn money into a number.
 */
export function money(value: Prisma.Decimal): string;
export function money(value: Prisma.Decimal | null): string | null;
export function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

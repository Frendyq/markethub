import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

function run(error: Prisma.PrismaClientKnownRequestError) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  new PrismaExceptionFilter().catch(error, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as { message: string } };
}

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test', meta });

describe('PrismaExceptionFilter', () => {
  it('maps a unique violation to 409 and names the constraint from the driver adapter', () => {
    const result = run(
      known('P2002', { driverAdapterError: { cause: { originalCode: '23505', constraint: { index: 'products_sku_key' } } } }),
    );
    expect(result.status).toBe(HttpStatus.CONFLICT);
    expect(result.body.message).toBe('Already exists (products_sku_key)');
  });

  it('maps a missing record to 404', () => {
    expect(run(known('P2025')).status).toBe(HttpStatus.NOT_FOUND);
  });

  it('maps a CHECK violation from a raw query to 409', () => {
    const result = run(known('P2010', { driverAdapterError: { cause: { originalCode: '23514' } } }));
    expect(result.status).toBe(HttpStatus.CONFLICT);
  });

  it('keeps unknown errors as 500 without leaking details', () => {
    const result = run(known('P1001'));
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.body.message).toBe('Internal server error');
  });
});

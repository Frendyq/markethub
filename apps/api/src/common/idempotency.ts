import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export type Idempotent<T> = { replayed: false; result: T } | { replayed: true; stored: Prisma.JsonValue | null };

const KEY = /^[A-Za-z0-9-]{8,100}$/;

/** Validates the optional Idempotency-Key header (a UUID in practice). */
export function idempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined || header === '') {
    return undefined;
  }
  if (!KEY.test(header)) {
    throw new BadRequestException('Idempotency-Key must be 8-100 characters: letters, digits and dashes');
  }
  return header;
}

/**
 * Runs `work` at most once per (user, key), inside the caller's transaction.
 *
 * The key row is inserted first with ON CONFLICT DO NOTHING. A concurrent request with the same key
 * waits on the unique index until this transaction ends, then sees the row and gets the stored result.
 * If `work` throws, the transaction rolls back together with the key, so the client may retry.
 */
export async function runOnce<T extends Prisma.InputJsonValue>(
  tx: Tx,
  userId: number,
  key: string | undefined,
  fingerprint: string,
  work: () => Promise<T>,
): Promise<Idempotent<T>> {
  if (!key) {
    return { replayed: false, result: await work() };
  }

  const inserted = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO idempotency_keys (user_id, key, fingerprint) VALUES (${userId}, ${key}, ${fingerprint})
    ON CONFLICT (user_id, key) DO NOTHING
    RETURNING id`;

  if (inserted.length === 0) {
    const previous = await tx.idempotencyKey.findUniqueOrThrow({ where: { userId_key: { userId, key } } });
    if (previous.fingerprint !== fingerprint) {
      throw new UnprocessableEntityException('This Idempotency-Key was already used for a different request');
    }
    return { replayed: true, stored: previous.response };
  }

  const result = await work();
  await tx.idempotencyKey.update({ where: { id: inserted[0].id }, data: { response: result } });
  return { replayed: false, result };
}

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  StockMovementType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { skipTake, type Paginated } from '../common/pagination.js';
import type { ExternalOrder } from '../connectors/connector.types.js';
import { ListingSyncScheduler } from '../sync/listing-sync.scheduler.js';
import {
  OrderQueryDto,
  OrderResponseDto,
  toOrderResponse,
} from './dto/order.dto.js';
import { runOnce } from '../common/idempotency.js';

export interface IngestResult {
  orderId: number;
  created: boolean;
  status: OrderStatus;
}

const INCLUDE = {
  marketplace: true,
  items: { orderBy: { id: 'asc' } },
} as const;

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: ListingSyncScheduler,
  ) {}

  /**
   * Stores a marketplace order and reserves its stock, exactly once.
   *
   * - The same order can arrive several times (webhook retries, webhook and polling both see it):
   *   INSERT ... ON CONFLICT DO NOTHING on (marketplace, external id) keeps one copy.
   * - A webhook event id, when given, is recorded in the same transaction, so a redelivered event is a no-op.
   * - Stock rows are locked with SELECT ... FOR UPDATE in product id order, so two orders for the last unit
   *   can't both reserve it, and two orders with the same products can't deadlock.
   * - The order is all or nothing: if any line can't be covered, nothing is reserved (BACKORDERED).
   */
  async ingest(
    marketplaceId: number,
    order: ExternalOrder,
    webhookEventId?: string,
  ): Promise<IngestResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      if (webhookEventId) {
        const fresh = await tx.$queryRaw<{ id: number }[]>`
          INSERT INTO processed_webhooks (marketplace_id, event_id) VALUES (${marketplaceId}, ${webhookEventId})
          ON CONFLICT (marketplace_id, event_id) DO NOTHING RETURNING id`;
        if (fresh.length === 0) {
          return this.existing(tx, marketplaceId, order.externalId);
        }
      }

      const inserted = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO orders (marketplace_id, external_id, status, currency, total_amount, customer_name, placed_at, updated_at)
        VALUES (${marketplaceId}, ${order.externalId}, 'BACKORDERED', ${order.currency}, ${order.total}::numeric,
                ${order.customerName}, ${order.placedAt}, now())
        ON CONFLICT (marketplace_id, external_id) DO NOTHING
        RETURNING id`;
      if (inserted.length === 0) {
        return this.existing(tx, marketplaceId, order.externalId);
      }
      const orderId = inserted[0].id;

      const products = await tx.product.findMany({
        where: { sku: { in: order.items.map((i) => i.sku) } },
        select: { id: true, sku: true },
      });
      const productBySku = new Map(products.map((p) => [p.sku, p.id]));
      await tx.orderItem.createMany({
        data: order.items.map((item) => ({
          orderId,
          productId: productBySku.get(item.sku) ?? null,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });

      const reserved = await this.reserve(tx, orderId, order, productBySku);
      const status =
        reserved.length > 0 ? OrderStatus.RESERVED : OrderStatus.BACKORDERED;
      if (status === OrderStatus.RESERVED) {
        await tx.order.update({ where: { id: orderId }, data: { status } });
      }
      return { orderId, created: true, status, changedProducts: reserved };
    });

    if (result.created) {
      this.logger.log(
        `Order ${order.externalId} from marketplace ${marketplaceId}: ${result.status}`,
      );
    }
    // Queue work only after the transaction committed: never talk to Redis or HTTP while holding row locks.
    if ('changedProducts' in result && result.changedProducts.length > 0) {
      await this.scheduler.scheduleProducts(
        result.changedProducts,
        `order ${result.orderId} reserved stock`,
      );
    }
    return {
      orderId: result.orderId,
      created: result.created,
      status: result.status,
    };
  }

  /** Returns the ids of products whose stock was reserved, or [] when the order can't be covered. */
  private async reserve(
    tx: Tx,
    orderId: number,
    order: ExternalOrder,
    productBySku: Map<string, number>,
  ): Promise<number[]> {
    const needed = new Map<number, number>();
    for (const item of order.items) {
      const productId = productBySku.get(item.sku);
      if (productId === undefined) {
        this.logger.warn(
          `Order ${order.externalId}: unknown SKU ${item.sku}, order is backordered`,
        );
        return [];
      }
      needed.set(productId, (needed.get(productId) ?? 0) + item.quantity);
    }
    const ids = [...needed.keys()].sort((a, b) => a - b);

    const rows = await tx.$queryRaw<
      { product_id: number; on_hand: number; reserved: number }[]
    >`
      SELECT product_id, on_hand, reserved FROM inventory
       WHERE product_id IN (${Prisma.join(ids)})
       ORDER BY product_id
         FOR UPDATE`;
    const covered = ids.every((id) => {
      const row = rows.find((r) => r.product_id === id);
      return (
        row !== undefined && row.on_hand - row.reserved >= (needed.get(id) ?? 0)
      );
    });
    if (!covered) {
      return [];
    }

    for (const id of ids) {
      const quantity = needed.get(id) ?? 0;
      await tx.$executeRaw`UPDATE inventory SET reserved = reserved + ${quantity}, updated_at = now() WHERE product_id = ${id}`;
      await tx.stockMovement.create({
        data: {
          productId: id,
          type: StockMovementType.RESERVE,
          quantity,
          orderId,
          reason: `Order ${order.externalId}`,
        },
      });
    }
    return ids;
  }

  private async existing(tx: Tx, marketplaceId: number, externalId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { marketplaceId_externalId: { marketplaceId, externalId } },
      select: { id: true, status: true },
    });
    return {
      orderId: order.id,
      created: false,
      status: order.status,
      changedProducts: [] as number[],
    };
  }

  async list(query: OrderQueryDto): Promise<Paginated<OrderResponseDto>> {
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      marketplaceId: query.marketplaceId,
    };
    if (query.search) {
      where.OR = [
        { externalId: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: INCLUDE,
        orderBy: { placedAt: 'desc' },
        ...skipTake(query),
      }),
    ]);
    return {
      items: rows.map(toOrderResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(id: number): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return toOrderResponse(order);
  }

  /** Goods left the warehouse: on hand and reserved both go down, available stays the same. */
  async ship(
    id: number,
    userId: number,
    key?: string,
  ): Promise<OrderResponseDto> {
    // A retried "ship" with the same key (the warehouse app lost the answer) returns the order as it is now.
    await this.prisma.$transaction((tx) =>
      runOnce(tx, userId, key, `POST /orders/${id}/ship`, async () => {
        await this.moveStatus(
          tx,
          id,
          [OrderStatus.RESERVED],
          OrderStatus.SHIPPED,
          { shippedAt: new Date() },
        );
        const items = await this.lines(tx, id);
        for (const [productId, quantity] of items) {
          await tx.$executeRaw`
          UPDATE inventory SET on_hand = on_hand - ${quantity}, reserved = reserved - ${quantity}, updated_at = now()
           WHERE product_id = ${productId}`;
          await tx.stockMovement.create({
            data: {
              productId,
              type: StockMovementType.SHIPMENT,
              quantity: -quantity,
              orderId: id,
              userId,
            },
          });
        }
        return { orderId: id };
      }),
    );
    return this.get(id);
  }

  /**
   * Tries again to reserve a BACKORDERED order, e.g. after new stock arrived.
   * Same locking rules as a new order; 409 if there is still not enough.
   */
  async retryReservation(id: number): Promise<OrderResponseDto> {
    const reserved = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: OrderStatus; external_id: string }[]
      >`
        SELECT status, external_id FROM orders WHERE id = ${id} FOR UPDATE`;
      if (rows.length === 0) {
        throw new NotFoundException(`Order ${id} not found`);
      }
      if (rows[0].status !== OrderStatus.BACKORDERED) {
        throw new ConflictException(
          `Order ${id} is ${rows[0].status}, expected BACKORDERED`,
        );
      }
      const items = await tx.orderItem.findMany({ where: { orderId: id } });
      if (items.some((item) => item.productId === null)) {
        throw new ConflictException(
          'The order has a SKU that is not in the catalog',
        );
      }
      const productBySku = new Map(
        items.map((item) => [item.sku, item.productId!]),
      );
      const order: ExternalOrder = {
        externalId: rows[0].external_id,
        placedAt: new Date(),
        currency: '',
        total: '0',
        customerName: null,
        items: items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
        })),
      };
      const products = await this.reserve(tx, id, order, productBySku);
      if (products.length === 0) {
        throw new ConflictException('Still not enough stock for this order');
      }
      await tx.order.update({
        where: { id },
        data: { status: OrderStatus.RESERVED },
      });
      return products;
    });
    await this.scheduler.scheduleProducts(
      reserved,
      `order ${id} reserved stock`,
    );
    return this.get(id);
  }

  async deliver(id: number): Promise<OrderResponseDto> {
    await this.prisma.$transaction((tx) =>
      this.moveStatus(tx, id, [OrderStatus.SHIPPED], OrderStatus.DELIVERED, {}),
    );
    return this.get(id);
  }

  /** Cancels an order that hasn't shipped; a reservation goes back to available stock. */
  async cancel(id: number, userId: number): Promise<OrderResponseDto> {
    const released = await this.prisma.$transaction(async (tx) => {
      const previous = await this.moveStatus(
        tx,
        id,
        [OrderStatus.RESERVED, OrderStatus.BACKORDERED],
        OrderStatus.CANCELLED,
        {
          cancelledAt: new Date(),
        },
      );
      if (previous !== OrderStatus.RESERVED) {
        return [];
      }
      const items = await this.lines(tx, id);
      for (const [productId, quantity] of items) {
        await tx.$executeRaw`UPDATE inventory SET reserved = reserved - ${quantity}, updated_at = now() WHERE product_id = ${productId}`;
        await tx.stockMovement.create({
          data: {
            productId,
            type: StockMovementType.RELEASE,
            quantity: -quantity,
            orderId: id,
            userId,
          },
        });
      }
      return [...items.keys()];
    });
    await this.scheduler.scheduleProducts(released, `order ${id} cancelled`);
    return this.get(id);
  }

  /**
   * Changes the status only if the order is in one of the expected statuses, in one UPDATE.
   * Two people pressing "ship" at once: the second gets 409 instead of shipping twice.
   */
  private async moveStatus(
    tx: Tx,
    id: number,
    from: OrderStatus[],
    to: OrderStatus,
    data: { shippedAt?: Date; cancelledAt?: Date },
  ): Promise<OrderStatus> {
    const current = await tx.$queryRaw<
      { status: OrderStatus }[]
    >`SELECT status FROM orders WHERE id = ${id} FOR UPDATE`;
    if (current.length === 0) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const previous = current[0].status;
    if (!from.includes(previous)) {
      throw new ConflictException(
        `Order ${id} is ${previous}, expected ${from.join(' or ')}`,
      );
    }
    await tx.order.update({ where: { id }, data: { status: to, ...data } });
    return previous;
  }

  /** Quantity per product of an order (lines with unknown products are skipped). */
  private async lines(tx: Tx, orderId: number): Promise<Map<number, number>> {
    const items = await tx.orderItem.findMany({
      where: { orderId, productId: { not: null } },
    });
    const byProduct = new Map<number, number>();
    for (const item of items) {
      byProduct.set(
        item.productId!,
        (byProduct.get(item.productId!) ?? 0) + item.quantity,
      );
    }
    return byProduct;
  }
}

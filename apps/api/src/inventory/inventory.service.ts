import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockMovementType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  skipTake,
  type PaginationQueryDto,
  type Paginated,
} from '../common/pagination.js';
import { toStock } from '../products/product.mapper.js';
import type { StockDto } from '../products/dto/product.dto.js';
import type {
  CreateMovementDto,
  MovementResponseDto,
} from './dto/inventory.dto.js';
import { ListingSyncScheduler } from '../sync/listing-sync.scheduler.js';
import { runOnce } from '../common/idempotency.js';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: ListingSyncScheduler,
  ) {}

  async getStock(productId: number): Promise<StockDto> {
    const inventory = await this.prisma.inventory.findUnique({
      where: { productId },
    });
    if (!inventory) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    return toStock(inventory);
  }

  async movements(
    productId: number,
    query: PaginationQueryDto,
  ): Promise<Paginated<MovementResponseDto>> {
    const where = { productId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { id: 'desc' },
        ...skipTake(query),
      }),
    ]);
    const items = rows.map((row) => ({
      id: row.id,
      type: row.type,
      quantity: row.quantity,
      reason: row.reason,
      userId: row.userId,
      createdAt: row.createdAt,
    }));
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Receipt or manual correction.
   * The change is one atomic UPDATE with the rule in its WHERE clause ("never below what is reserved"),
   * so two concurrent corrections can't both pass a check made in application code.
   */
  async addMovement(
    productId: number,
    dto: CreateMovementDto,
    userId: number,
    key?: string,
  ): Promise<StockDto> {
    if (dto.type === StockMovementType.RECEIPT && dto.quantity < 0) {
      throw new BadRequestException('A receipt must have a positive quantity');
    }

    const outcome = await this.prisma.$transaction((tx) =>
      runOnce(
        tx,
        userId,
        key,
        `POST /inventory/${productId}/movements`,
        async () => {
          const changed = await tx.$executeRaw`
        UPDATE inventory
           SET on_hand = on_hand + ${dto.quantity}, updated_at = now()
         WHERE product_id = ${productId}
           AND on_hand + ${dto.quantity} >= reserved`;

          if (changed === 0) {
            const exists = await tx.inventory.findUnique({
              where: { productId },
              select: { productId: true },
            });
            if (!exists) {
              throw new NotFoundException(`Product ${productId} not found`);
            }
            throw new ConflictException(
              'Stock would drop below the reserved quantity',
            );
          }

          await tx.stockMovement.create({
            data: {
              productId,
              type: dto.type,
              quantity: dto.quantity,
              reason: dto.reason,
              userId,
            },
          });

          const inventory = await tx.inventory.findUniqueOrThrow({
            where: { productId },
          });
          return { ...toStock(inventory) };
        },
      ),
    );
    if (outcome.replayed) {
      // Already applied by an earlier request with the same key: answer what it answered.
      return outcome.stored as unknown as StockDto;
    }
    // After commit: tell the marketplaces about the new quantity.
    await this.scheduler.scheduleProducts(
      [productId],
      `stock ${dto.type.toLowerCase()}`,
    );
    return outcome.result;
  }
}

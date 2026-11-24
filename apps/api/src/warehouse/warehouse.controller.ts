import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export class PickingItemDto {
  @ApiPropertyOptional({ type: Number, nullable: true }) productId: number | null;
  @ApiProperty() sku: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Barcode to scan' }) ean: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'A-03-2' }) location: string | null;
  @ApiProperty() quantity: number;
}

export class PickingOrderDto {
  @ApiProperty() id: number;
  @ApiProperty() marketplace: string;
  @ApiProperty() externalId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() placedAt: Date;
  @ApiProperty({ type: [PickingItemDto] }) items: PickingItemDto[];
}

const LIMIT = 100;

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Orders waiting to be picked (stock reserved), oldest first, with everything the picker needs
   * in one response: where each item is and which barcode to scan. Lines are sorted by location
   * so the picker walks the aisles once.
   */
  async picking(): Promise<PickingOrderDto[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.RESERVED },
      include: {
        marketplace: { select: { code: true } },
        items: { include: { product: { select: { title: true, ean: true, location: true } } } },
      },
      orderBy: { placedAt: 'asc' },
      take: LIMIT,
    });
    return orders.map((order) => ({
      id: order.id,
      marketplace: order.marketplace.code,
      externalId: order.externalId,
      customerName: order.customerName,
      placedAt: order.placedAt,
      items: order.items
        .map((item) => ({
          productId: item.productId,
          sku: item.sku,
          title: item.product?.title ?? item.sku,
          ean: item.product?.ean ?? null,
          location: item.product?.location ?? null,
          quantity: item.quantity,
        }))
        .sort((a, b) => (a.location ?? '~').localeCompare(b.location ?? '~')),
    }));
  }
}

@ApiTags('warehouse')
@ApiBearerAuth()
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('picking')
  picking(): Promise<PickingOrderDto[]> {
    return this.warehouse.picking();
  }
}

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {}

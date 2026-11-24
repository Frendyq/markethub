import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus, type Marketplace, type Order, type OrderItem } from '../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../common/pagination.js';
import { money } from '../../common/money.js';

export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  marketplaceId?: number;

  @ApiPropertyOptional({ description: 'Part of the marketplace order number or the customer name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class OrderItemDto {
  @ApiProperty() id: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) productId: number | null;
  @ApiProperty() sku: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ example: '1283.99' }) unitPrice: string;
}

export class OrderResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() marketplace: string;
  @ApiProperty() externalId: string;
  @ApiProperty({ enum: OrderStatus }) status: OrderStatus;
  @ApiProperty() currency: string;
  @ApiProperty({ example: '1283.99' }) totalAmount: string;
  @ApiPropertyOptional({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() placedAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) shippedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) cancelledAt: Date | null;
  @ApiProperty({ type: [OrderItemDto] }) items: OrderItemDto[];
}

export function toOrderResponse(order: Order & { marketplace: Marketplace; items: OrderItem[] }): OrderResponseDto {
  return {
    id: order.id,
    marketplace: order.marketplace.code,
    externalId: order.externalId,
    status: order.status,
    currency: order.currency,
    totalAmount: money(order.totalAmount),
    customerName: order.customerName,
    placedAt: order.placedAt,
    shippedAt: order.shippedAt,
    cancelledAt: order.cancelledAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
    })),
  };
}

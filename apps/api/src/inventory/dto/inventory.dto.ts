import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';
import { StockMovementType } from '../../generated/prisma/client.js';

/** Manual movements only. Reserve, release and shipment come from orders. */
export const MANUAL_MOVEMENTS = [StockMovementType.RECEIPT, StockMovementType.ADJUSTMENT] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENTS)[number];

export class CreateMovementDto {
  @ApiProperty({ enum: MANUAL_MOVEMENTS, example: StockMovementType.RECEIPT })
  @IsIn(MANUAL_MOVEMENTS)
  type: ManualMovementType;

  @ApiProperty({ example: 10, description: 'RECEIPT: positive. ADJUSTMENT: positive or negative' })
  @IsInt()
  @NotEquals(0)
  @Min(-100_000)
  @Max(100_000)
  quantity: number;

  @ApiPropertyOptional({ example: 'Delivery from the factory, invoice 2026-118' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class MovementResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: StockMovementType }) type: StockMovementType;
  @ApiProperty() quantity: number;
  @ApiPropertyOptional({ type: String, nullable: true }) reason: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) userId: number | null;
  @ApiProperty() createdAt: Date;
}

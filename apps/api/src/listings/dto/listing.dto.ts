import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ListingStatus, type Listing, type Marketplace, type Product } from '../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../common/pagination.js';
import { money } from '../../common/money.js';

export class CreateListingsDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  productId: number;

  @ApiPropertyOptional({ type: [Number], description: 'Leave out to list on every enabled marketplace' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  marketplaceIds?: number[];

  @ApiPropertyOptional({ default: false, description: 'Push to the marketplaces right away' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class ListingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  marketplaceId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}

export class ListingResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() title: string;
  @ApiProperty() marketplaceId: number;
  @ApiProperty() marketplace: string;
  @ApiProperty({ enum: ListingStatus }) status: ListingStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) externalId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) price: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currency: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) quantity: number | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) lastSyncedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError: string | null;
}

export function toListingResponse(
  listing: Listing & { product: Pick<Product, 'sku' | 'title'>; marketplace: Pick<Marketplace, 'code'> },
): ListingResponseDto {
  return {
    id: listing.id,
    productId: listing.productId,
    sku: listing.product.sku,
    title: listing.product.title,
    marketplaceId: listing.marketplaceId,
    marketplace: listing.marketplace.code,
    status: listing.status,
    externalId: listing.externalId,
    price: money(listing.price),
    currency: listing.currency,
    quantity: listing.quantity,
    lastSyncedAt: listing.lastSyncedAt,
    lastError: listing.lastError,
  };
}

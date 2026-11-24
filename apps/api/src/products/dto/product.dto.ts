import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';

// Money comes in as a string ("1299.90"): a JSON number may already have lost precision.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const WEIGHT = /^\d{1,5}(\.\d{1,3})?$/;

export class CreateProductDto {
  @ApiProperty({ example: 'SOFA-OSLO-3S-GRY', description: 'Upper case letters, digits and dashes' })
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,39}$/, { message: 'sku: 3-40 characters, A-Z, 0-9 and dashes' })
  sku: string;

  @ApiProperty({ example: 'Oslo 3-seater sofa, grey' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ example: 'sofas' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  category: string;

  @ApiPropertyOptional({ example: '4006381333931', description: 'EAN-13' })
  @IsOptional()
  @Matches(/^\d{13}$/, { message: 'ean must be 13 digits' })
  ean?: string;

  @ApiProperty({ example: '410.00', description: 'Purchase cost in EUR' })
  @Matches(MONEY, { message: 'costPrice must be a decimal with up to 2 digits after the point' })
  costPrice: string;

  @ApiProperty({ example: '899.00', description: 'Catalog price in EUR before marketplace fees and VAT' })
  @Matches(MONEY, { message: 'basePrice must be a decimal with up to 2 digits after the point' })
  basePrice: string;

  @ApiProperty({ example: '54.500' })
  @Matches(WEIGHT, { message: 'weightKg must be a decimal with up to 3 digits after the point' })
  weightKg: string;

  @ApiProperty({ example: 210 })
  @IsInt()
  @Min(1)
  @Max(1000)
  widthCm: number;

  @ApiProperty({ example: 85 })
  @IsInt()
  @Min(1)
  @Max(1000)
  heightCm: number;

  @ApiProperty({ example: 95 })
  @IsInt()
  @Min(1)
  @Max(1000)
  depthCm: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ default: 0, description: 'Units in the warehouse right now' })
  @IsOptional()
  @IsInt()
  @Min(0)
  initialStock?: number;
}

// skipNullProperties: false -> "title": null is rejected instead of reaching the database.
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['sku', 'initialStock'] as const), {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Part of the title or SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Only products with available stock at or below this number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStock?: number;
}

export class StockDto {
  @ApiProperty() onHand: number;
  @ApiProperty() reserved: number;
  @ApiProperty() available: number;
}

export class ProductResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty() category: string;
  @ApiPropertyOptional({ type: String, nullable: true }) ean: string | null;
  @ApiProperty({ example: '410.00' }) costPrice: string;
  @ApiProperty({ example: '899.00' }) basePrice: string;
  @ApiProperty({ example: '54.500' }) weightKg: string;
  @ApiProperty() widthCm: number;
  @ApiProperty() heightCm: number;
  @ApiProperty() depthCm: number;
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: StockDto }) stock: StockDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ProductListingDto {
  @ApiProperty() id: number;
  @ApiProperty() marketplace: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional({ type: String, nullable: true }) price: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currency: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) quantity: number | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) lastSyncedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError: string | null;
}

export class ProductDetailResponseDto extends ProductResponseDto {
  @ApiProperty({ type: [ProductListingDto] }) listings: ProductListingDto[];
}

export class ProductPageDto {
  @ApiProperty({ type: [ProductResponseDto] }) items: ProductResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class MarketplacePriceDto {
  @ApiProperty({ example: 'otto' }) marketplace: string;
  @ApiProperty({ example: 'EUR' }) currency: string;
  @ApiProperty({ example: '1283.99', description: 'Price the buyer pays' }) price: string;
  @ApiProperty() vatAmount: string;
  @ApiProperty() feeAmount: string;
  @ApiProperty({ description: 'What the seller keeps, in EUR' }) proceedsEur: string;
  @ApiProperty() marginEur: string;
  @ApiProperty() marginPercent: string;
  @ApiProperty() belowMinMargin: boolean;
}

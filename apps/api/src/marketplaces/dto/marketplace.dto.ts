import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import type { Marketplace } from '../../generated/prisma/client.js';

const PERCENT = /^\d{1,2}(\.\d{1,2})?$/;

export class UpdateMarketplaceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ example: '15.00', description: 'Marketplace commission, percent of the gross price' })
  @IsOptional()
  @Matches(PERCENT, { message: 'feePercent must look like 15 or 15.50' })
  feePercent?: string;

  @ApiPropertyOptional({ example: '19.00' })
  @IsOptional()
  @Matches(PERCENT, { message: 'vatPercent must look like 19 or 19.00' })
  vatPercent?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  rateLimitPerSec?: number;
}

export class MarketplaceResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'otto' }) code: string;
  @ApiProperty({ example: 'OTTO Market' }) name: string;
  @ApiProperty({ example: 'DE' }) country: string;
  @ApiProperty({ example: 'EUR' }) currency: string;
  @ApiProperty({ example: '15.00' }) feePercent: string;
  @ApiProperty({ example: '19.00' }) vatPercent: string;
  @ApiProperty() rateLimitPerSec: number;
  @ApiProperty() isEnabled: boolean;
}

export function toMarketplaceResponse(m: Marketplace): MarketplaceResponseDto {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    country: m.country,
    currency: m.currency,
    feePercent: m.feePercent.toFixed(2),
    vatPercent: m.vatPercent.toFixed(2),
    rateLimitPerSec: m.rateLimitPerSec,
    isEnabled: m.isEnabled,
  };
}

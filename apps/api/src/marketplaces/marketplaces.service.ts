import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decimal } from '../common/money.js';
import { MarketplaceResponseDto, toMarketplaceResponse, UpdateMarketplaceDto } from './dto/marketplace.dto.js';

@Injectable()
export class MarketplacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<MarketplaceResponseDto[]> {
    const rows = await this.prisma.marketplace.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toMarketplaceResponse);
  }

  async update(id: number, dto: UpdateMarketplaceDto): Promise<MarketplaceResponseDto> {
    const row = await this.prisma.marketplace.update({
      where: { id },
      data: {
        isEnabled: dto.isEnabled,
        feePercent: dto.feePercent === undefined ? undefined : decimal(dto.feePercent),
        vatPercent: dto.vatPercent === undefined ? undefined : decimal(dto.vatPercent),
        rateLimitPerSec: dto.rateLimitPerSec,
      },
    });
    return toMarketplaceResponse(row);
  }
}

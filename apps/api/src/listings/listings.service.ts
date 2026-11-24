import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListingSyncScheduler } from '../sync/listing-sync.scheduler.js';
import { skipTake, type Paginated } from '../common/pagination.js';
import { CreateListingsDto, ListingQueryDto, ListingResponseDto, toListingResponse } from './dto/listing.dto.js';

const INCLUDE = {
  product: { select: { sku: true, title: true } },
  marketplace: { select: { code: true } },
} as const;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: ListingSyncScheduler,
  ) {}

  async list(query: ListingQueryDto): Promise<Paginated<ListingResponseDto>> {
    const where: Prisma.ListingWhereInput = {
      marketplaceId: query.marketplaceId,
      productId: query.productId,
      status: query.status,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({ where, include: INCLUDE, orderBy: { id: 'asc' }, ...skipTake(query) }),
    ]);
    return { items: rows.map(toListingResponse), total, page: query.page, limit: query.limit };
  }

  async get(id: number): Promise<ListingResponseDto> {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: INCLUDE });
    if (!listing) {
      throw new NotFoundException(`Listing ${id} not found`);
    }
    return toListingResponse(listing);
  }

  /** Sends the listing to its marketplace now (first publish, or a manual retry after an error). */
  async publish(id: number): Promise<ListingResponseDto> {
    const queued = await this.scheduler.scheduleListing(id, 'manual push', true);
    if (!queued) {
      const exists = await this.prisma.listing.findUnique({ where: { id }, select: { id: true } });
      throw exists ? new BadRequestException('The marketplace is disabled') : new NotFoundException(`Listing ${id} not found`);
    }
    return this.get(id);
  }

  /**
   * Puts a product on marketplaces as DRAFT listings. Listing it twice on the same marketplace
   * is not an error: the unique (product, marketplace) index makes createMany skip it.
   * Returns every listing of the product.
   */
  async create(dto: CreateListingsDto): Promise<ListingResponseDto[]> {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId }, select: { isActive: true } });
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }
    if (!product.isActive) {
      throw new BadRequestException('An archived product cannot be listed');
    }

    const marketplaces = await this.prisma.marketplace.findMany({
      where: dto.marketplaceIds ? { id: { in: dto.marketplaceIds } } : { isEnabled: true },
      select: { id: true, isEnabled: true },
    });
    if (dto.marketplaceIds && marketplaces.length !== dto.marketplaceIds.length) {
      throw new NotFoundException('Unknown marketplace id');
    }
    const disabled = marketplaces.filter((m) => !m.isEnabled);
    if (disabled.length > 0) {
      throw new BadRequestException(`Marketplace ${disabled.map((m) => m.id).join(', ')} is disabled`);
    }

    await this.prisma.listing.createMany({
      data: marketplaces.map((m) => ({ productId: dto.productId, marketplaceId: m.id })),
      skipDuplicates: true,
    });

    if (dto.publish) {
      const created = await this.prisma.listing.findMany({
        where: { productId: dto.productId, marketplaceId: { in: marketplaces.map((m) => m.id) } },
        select: { id: true },
      });
      await Promise.all(created.map((l) => this.scheduler.scheduleListing(l.id, 'published')));
    }

    const rows = await this.prisma.listing.findMany({
      where: { productId: dto.productId },
      include: INCLUDE,
      orderBy: { marketplaceId: 'asc' },
    });
    return rows.map(toListingResponse);
  }
}

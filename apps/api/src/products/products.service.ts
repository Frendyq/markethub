import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovementType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingClient } from '../pricing/pricing.client.js';
import { ListingSyncScheduler } from '../sync/listing-sync.scheduler.js';
import { decimal } from '../common/money.js';
import { skipTake, type Paginated } from '../common/pagination.js';
import {
  CreateProductDto,
  MarketplacePriceDto,
  ProductDetailResponseDto,
  ProductQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import { toProductDetail, toProductResponse } from './product.mapper.js';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingClient,
    private readonly scheduler: ListingSyncScheduler,
  ) {}

  async list(query: ProductQueryDto): Promise<Paginated<ProductResponseDto>> {
    const where = await this.buildWhere(query);
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: { inventory: true },
        orderBy: { id: 'asc' },
        ...skipTake(query),
      }),
    ]);
    return { items: products.map(toProductResponse), total, page: query.page, limit: query.limit };
  }

  async get(id: number): Promise<ProductDetailResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { inventory: true, listings: { include: { marketplace: true }, orderBy: { marketplaceId: 'asc' } } },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return toProductDetail(product);
  }

  async create(dto: CreateProductDto, userId: number): Promise<ProductResponseDto> {
    const initialStock = dto.initialStock ?? 0;
    // Product, its inventory row and the first stock movement are written in one statement (one transaction).
    const product = await this.prisma.product.create({
      data: {
        sku: dto.sku,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        ean: dto.ean,
        costPrice: decimal(dto.costPrice),
        basePrice: decimal(dto.basePrice),
        weightKg: decimal(dto.weightKg),
        widthCm: dto.widthCm,
        heightCm: dto.heightCm,
        depthCm: dto.depthCm,
        imageUrl: dto.imageUrl,
        location: dto.location,
        inventory: { create: { onHand: initialStock } },
        stockMovements:
          initialStock > 0
            ? { create: { type: StockMovementType.RECEIPT, quantity: initialStock, reason: 'Initial stock', userId } }
            : undefined,
      },
      include: { inventory: true },
    });
    return toProductResponse(product);
  }

  async update(id: number, dto: UpdateProductDto): Promise<ProductResponseDto> {
    // A missing product makes Prisma throw P2025, which the filter answers with 404.
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        ean: dto.ean,
        costPrice: dto.costPrice === undefined ? undefined : decimal(dto.costPrice),
        basePrice: dto.basePrice === undefined ? undefined : decimal(dto.basePrice),
        weightKg: dto.weightKg === undefined ? undefined : decimal(dto.weightKg),
        widthCm: dto.widthCm,
        heightCm: dto.heightCm,
        depthCm: dto.depthCm,
        imageUrl: dto.imageUrl,
        location: dto.location,
        isActive: dto.isActive,
      },
      include: { inventory: true },
    });
    // Price, title or availability may have changed: refresh every published listing.
    await this.scheduler.scheduleProducts([id], 'product updated');
    return toProductResponse(product);
  }

  /** Products are archived, not deleted: orders and history keep pointing at them. */
  async archive(id: number): Promise<void> {
    await this.prisma.product.update({ where: { id }, data: { isActive: false } });
    // Archived products are pushed with quantity 0, which hides them on the marketplaces.
    await this.scheduler.scheduleProducts([id], 'product archived');
  }

  /** What the product would cost on each enabled marketplace, calculated by the Rust pricing-engine. */
  async prices(id: number): Promise<MarketplacePriceDto[]> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { sku: true, basePrice: true, costPrice: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const marketplaces = await this.prisma.marketplace.findMany({ where: { isEnabled: true }, orderBy: { id: 'asc' } });
    const item = { sku: product.sku, basePrice: product.basePrice.toFixed(2), costPrice: product.costPrice.toFixed(2) };

    // One call per marketplace, in parallel: they don't depend on each other.
    const results = await Promise.all(marketplaces.map((m) => this.pricing.calculate(m.code, [item])));
    return results.map((result) => {
      const quote = result.items[0];
      return {
        marketplace: result.marketplace,
        currency: quote.currency,
        price: quote.price,
        vatAmount: quote.vatAmount,
        feeAmount: quote.feeAmount,
        proceedsEur: quote.proceedsEur,
        marginEur: quote.marginEur,
        marginPercent: quote.marginPercent,
        belowMinMargin: quote.belowMinMargin,
      };
    });
  }

  /** Scanner lookup: the barcode on the box is the EAN-13. */
  async byEan(ean: string): Promise<ProductResponseDto> {
    const product = await this.prisma.product.findUnique({ where: { ean }, include: { inventory: true } });
    if (!product) {
      throw new NotFoundException(`No product with EAN ${ean}`);
    }
    return toProductResponse(product);
  }

  async categories(): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return rows.map((row) => row.category);
  }

  private async buildWhere(query: ProductQueryDto): Promise<Prisma.ProductWhereInput> {
    const where: Prisma.ProductWhereInput = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.category) {
      where.category = query.category;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.lowStock !== undefined) {
      // "available <= N" compares two columns, which Prisma's filters can't express: ask SQL for the ids.
      const rows = await this.prisma.$queryRaw<{ product_id: number }[]>`
        SELECT product_id FROM inventory WHERE on_hand - reserved <= ${query.lowStock}`;
      where.id = { in: rows.map((row) => row.product_id) };
    }
    return where;
  }
}

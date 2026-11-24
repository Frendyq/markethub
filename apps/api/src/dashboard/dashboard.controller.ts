import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ListingStatus, OrderStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toOrderResponse, type OrderResponseDto } from '../orders/dto/order.dto.js';

const LOW_STOCK = 2;

export interface DashboardDto {
  products: { total: number; active: number; lowStock: number; outOfStock: number };
  orders: { today: number; reserved: number; backordered: number; revenueToday: { currency: string; amount: string }[] };
  listings: Record<ListingStatus, number>;
  recentOrders: OrderResponseDto[];
  recentFailures: { id: number; marketplace: string | null; sku: string | null; error: string | null; createdAt: Date }[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(): Promise<DashboardDto> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [total, active, stock, ordersToday, reserved, backordered, revenue, listingGroups, recentOrders, failures, marketplaces] =
      await Promise.all([
        this.prisma.product.count(),
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.$queryRaw<{ low: number; out: number }[]>`
          SELECT count(*) FILTER (WHERE i.on_hand - i.reserved BETWEEN 1 AND ${LOW_STOCK})::int AS low,
                 count(*) FILTER (WHERE i.on_hand - i.reserved <= 0)::int AS out
            FROM inventory i JOIN products p ON p.id = i.product_id
           WHERE p.is_active`,
        this.prisma.order.count({ where: { placedAt: { gte: startOfDay } } }),
        this.prisma.order.count({ where: { status: OrderStatus.RESERVED } }),
        this.prisma.order.count({ where: { status: OrderStatus.BACKORDERED } }),
        this.prisma.order.groupBy({
          by: ['currency'],
          where: { placedAt: { gte: startOfDay }, status: { not: OrderStatus.CANCELLED } },
          _sum: { totalAmount: true },
        }),
        this.prisma.listing.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.order.findMany({
          include: { marketplace: true, items: true },
          orderBy: { placedAt: 'desc' },
          take: 6,
        }),
        this.prisma.syncRun.findMany({ where: { status: 'FAILED' }, orderBy: { id: 'desc' }, take: 6 }),
        this.prisma.marketplace.findMany({ select: { id: true, code: true } }),
      ]);

    const listings = Object.fromEntries(Object.values(ListingStatus).map((s) => [s, 0])) as Record<ListingStatus, number>;
    for (const group of listingGroups) {
      listings[group.status] = group._count._all;
    }
    const codes = new Map(marketplaces.map((m) => [m.id, m.code]));
    const failedListings = await this.prisma.listing.findMany({
      where: { id: { in: failures.map((f) => f.listingId).filter((id): id is number => id !== null) } },
      select: { id: true, product: { select: { sku: true } } },
    });
    const skuByListing = new Map(failedListings.map((l) => [l.id, l.product.sku]));

    return {
      products: { total, active, lowStock: stock[0]?.low ?? 0, outOfStock: stock[0]?.out ?? 0 },
      orders: {
        today: ordersToday,
        reserved,
        backordered,
        revenueToday: revenue.map((r) => ({ currency: r.currency, amount: (r._sum.totalAmount ?? 0).toFixed(2) })),
      },
      listings,
      recentOrders: recentOrders.map(toOrderResponse),
      recentFailures: failures.map((f) => ({
        id: f.id,
        marketplace: f.marketplaceId === null ? null : (codes.get(f.marketplaceId) ?? null),
        sku: f.listingId === null ? null : (skuByListing.get(f.listingId) ?? null),
        error: f.error,
        createdAt: f.createdAt,
      })),
    };
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(): Promise<DashboardDto> {
    return this.dashboard.summary();
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

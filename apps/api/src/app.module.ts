import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProductsModule } from './products/products.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { MarketplacesModule } from './marketplaces/marketplaces.module.js';
import { ListingsModule } from './listings/listings.module.js';
import { HealthController } from './health/health.controller.js';
import { OrdersModule } from './orders/orders.module.js';
import { FeedsModule } from './feeds/feeds.module.js';
import { DashboardModule } from './dashboard/dashboard.controller.js';
import { QueueDashboardModule } from './sync/queue-dashboard.module.js';
import { bullRoot } from './sync/queues.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    bullRoot,
    SyncModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    InventoryModule,
    MarketplacesModule,
    ListingsModule,
    OrdersModule,
    FeedsModule,
    DashboardModule,
    QueueDashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      // whitelist + forbidNonWhitelisted: unknown fields are a 400, not silently passed to the database.
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}

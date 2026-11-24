import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../config/env.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { bullRoot } from '../sync/queues.js';
import { SyncWorkers } from './sync.workers.js';

/** The queue worker process: no HTTP server, only BullMQ workers. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    bullRoot,
    SyncModule,
    PricingModule,
    OrdersModule,
  ],
  providers: [SyncWorkers],
})
export class WorkerModule {}

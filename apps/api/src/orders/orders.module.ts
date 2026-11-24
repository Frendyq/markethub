import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [SyncModule],
  controllers: [OrdersController, WebhooksController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

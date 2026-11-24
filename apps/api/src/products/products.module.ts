import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [PricingModule, SyncModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

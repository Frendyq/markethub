import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { FeedsController } from './feeds.controller.js';
import { FeedsService } from './feeds.service.js';

@Module({
  imports: [PricingModule, SyncModule],
  controllers: [FeedsController],
  providers: [FeedsService],
})
export class FeedsModule {}

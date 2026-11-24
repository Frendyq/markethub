import { Module } from '@nestjs/common';
import { PricingClient } from './pricing.client.js';

@Module({
  providers: [PricingClient],
  exports: [PricingClient],
})
export class PricingModule {}

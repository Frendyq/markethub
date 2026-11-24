import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConnectorRegistry } from '../connectors/connector.registry.js';
import { ListingSyncScheduler } from './listing-sync.scheduler.js';
import { MARKETPLACE_QUEUES } from './queues.js';

/** Queues (producers only) and marketplace connectors. The workers live in WorkerModule. */
@Module({
  imports: [BullModule.registerQueue(...MARKETPLACE_QUEUES.map((name) => ({ name })))],
  providers: [ListingSyncScheduler, ConnectorRegistry],
  exports: [BullModule, ListingSyncScheduler, ConnectorRegistry],
})
export class SyncModule {}

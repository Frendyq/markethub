import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module.js';

/**
 * Second entry point of the same codebase: runs the BullMQ workers in their own process,
 * so slow marketplace calls never take CPU or connections from the HTTP API.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Queue worker started', 'Worker');
}

await bootstrap();

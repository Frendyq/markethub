import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queueName } from '../sync/queues.js';

type Check = 'up' | 'down';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(queueName('amazon')) private readonly queue: Queue,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the app can serve requests, so PostgreSQL and Redis answer. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: Check; redis: Check }> {
    const [database, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up' as const).catch(() => 'down' as const),
      // Any queue read is a round trip to Redis. BullMQ waits for Redis forever, so the probe has its own deadline.
      Promise.race([
        this.queue.getJobCounts('waiting').then(() => 'up' as const),
        new Promise<'down'>((resolve) => setTimeout(() => resolve('down'), 2_000)),
      ]).catch(() => 'down' as const),
    ]);
    if (database === 'down' || redis === 'down') {
      throw new ServiceUnavailableException({ status: 'error', database, redis });
    }
    return { status: 'ok', database, redis };
  }
}

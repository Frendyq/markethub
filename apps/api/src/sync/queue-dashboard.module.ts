import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import { MARKETPLACE_QUEUES } from './queues.js';
import { SyncModule } from './sync.module.js';

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Basic auth: the dashboard is opened in a browser, where a bearer token isn't sent automatically. */
function basicAuth(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const [givenUser, givenPassword] = Buffer.from(encoded ?? '', 'base64').toString().split(':');
    if (scheme === 'Basic' && same(givenUser ?? '', user) && same(givenPassword ?? '', password)) {
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="MarketHub queues"');
    res.status(401).send('Authentication required');
  };
}

/** Bull Board at /admin/queues: waiting, active, failed jobs per marketplace, with retry buttons. */
@Module({
  imports: [
    SyncModule,
    BullBoardModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        route: '/admin/queues',
        adapter: ExpressAdapter,
        middleware: basicAuth(
          config.get('QUEUE_DASHBOARD_USER', { infer: true }),
          config.get('QUEUE_DASHBOARD_PASSWORD', { infer: true }),
        ),
      }),
    }),
    BullBoardModule.forFeature(...MARKETPLACE_QUEUES.map((name) => ({ name, adapter: BullMQAdapter }))),
  ],
})
export class QueueDashboardModule {}

import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ConnectorRegistry } from '../connectors/connector.registry.js';
import { PermanentMarketplaceError } from '../connectors/connector.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from './orders.service.js';

interface WebhookBody {
  type?: string;
  order?: unknown;
}

/**
 * "Order created" notifications from marketplaces.
 * Checks the HMAC signature of the raw body, then hands the order to OrdersService.ingest,
 * which makes a repeated delivery harmless.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks')
export class WebhooksController {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly connectors: ConnectorRegistry,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('WEBHOOK_SECRET', { infer: true });
  }

  @Post(':code')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('code') code: string,
    @Headers('x-event-id') eventId: string | undefined,
    @Headers('x-markethub-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored'; orderId?: number }> {
    if (!request.rawBody || !signature || !this.validSignature(request.rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    if (!eventId || eventId.length > 100) {
      throw new BadRequestException('x-event-id header is required');
    }
    const marketplace = await this.prisma.marketplace.findUnique({ where: { code } });
    if (!marketplace || !this.connectors.has(code)) {
      throw new NotFoundException(`Unknown marketplace ${code}`);
    }

    const body = request.body as WebhookBody;
    if (body.type !== 'order.created') {
      return { status: 'ignored' };
    }
    let order;
    try {
      order = this.connectors.get(code).parseOrder(body.order);
    } catch (error) {
      if (error instanceof PermanentMarketplaceError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const result = await this.orders.ingest(marketplace.id, order, eventId);
    return { status: result.created ? 'processed' : 'duplicate', orderId: result.orderId };
  }

  private validSignature(rawBody: Buffer, signature: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac('sha256', this.secret).update(rawBody).digest('hex')}`);
    const received = Buffer.from(signature);
    // Constant-time comparison: the time it takes must not reveal how many characters matched.
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}

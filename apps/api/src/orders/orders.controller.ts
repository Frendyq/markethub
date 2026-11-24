import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import type { Paginated } from '../common/pagination.js';
import { OrderQueryDto, OrderResponseDto } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: OrderQueryDto): Promise<Paginated<OrderResponseDto>> {
    return this.orders.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<OrderResponseDto> {
    return this.orders.get(id);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  ship(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<OrderResponseDto> {
    return this.orders.ship(id, user.id);
  }

  /** Backordered order: try to reserve stock again (after a delivery). */
  @Post(':id/reserve')
  @HttpCode(HttpStatus.OK)
  reserve(@Param('id', ParseIntPipe) id: number): Promise<OrderResponseDto> {
    return this.orders.retryReservation(id);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  deliver(@Param('id', ParseIntPipe) id: number): Promise<OrderResponseDto> {
    return this.orders.deliver(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser): Promise<OrderResponseDto> {
    return this.orders.cancel(id, user.id);
  }
}

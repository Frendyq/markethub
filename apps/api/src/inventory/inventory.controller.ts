import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { PaginationQueryDto, type Paginated } from '../common/pagination.js';
import type { StockDto } from '../products/dto/product.dto.js';
import { CreateMovementDto, MovementResponseDto } from './dto/inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(':productId')
  stock(@Param('productId', ParseIntPipe) productId: number): Promise<StockDto> {
    return this.inventory.getStock(productId);
  }

  @Get(':productId/movements')
  movements(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<MovementResponseDto>> {
    return this.inventory.movements(productId, query);
  }

  @Post(':productId/movements')
  addMovement(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() body: CreateMovementDto,
    @CurrentUser() user: AuthUser,
  ): Promise<StockDto> {
    return this.inventory.addMovement(productId, body, user.id);
  }
}

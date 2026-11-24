import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import type { Paginated } from '../common/pagination.js';
import {
  CreateProductDto,
  MarketplacePriceDto,
  ProductDetailResponseDto,
  ProductPageDto,
  ProductQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOkResponse({ type: ProductPageDto })
  list(@Query() query: ProductQueryDto): Promise<Paginated<ProductResponseDto>> {
    return this.products.list(query);
  }

  // Static path before ':id', otherwise Express would match "categories" as an id.
  @Get('categories')
  categories(): Promise<string[]> {
    return this.products.categories();
  }

  @Get('by-ean/:ean')
  byEan(@Param('ean') ean: string): Promise<ProductResponseDto> {
    if (!/^\d{8,14}$/.test(ean)) {
      throw new BadRequestException('EAN must be 8-14 digits');
    }
    return this.products.byEan(ean);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<ProductDetailResponseDto> {
    return this.products.get(id);
  }

  @Get(':id/prices')
  prices(@Param('id', ParseIntPipe) id: number): Promise<MarketplacePriceDto[]> {
    return this.products.prices(id);
  }

  @Post()
  create(@Body() body: CreateProductDto, @CurrentUser() user: AuthUser): Promise<ProductResponseDto> {
    return this.products.create(body, user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateProductDto): Promise<ProductResponseDto> {
    return this.products.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.products.archive(id);
  }
}

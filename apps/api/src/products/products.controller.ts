import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import type { Paginated } from '../common/pagination.js';
import {
  CreateProductDto,
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

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<ProductDetailResponseDto> {
    return this.products.get(id);
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

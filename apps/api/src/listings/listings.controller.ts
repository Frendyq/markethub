import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../common/pagination.js';
import { CreateListingsDto, ListingQueryDto, ListingResponseDto } from './dto/listing.dto.js';
import { ListingsService } from './listings.service.js';

@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  list(@Query() query: ListingQueryDto): Promise<Paginated<ListingResponseDto>> {
    return this.listings.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<ListingResponseDto> {
    return this.listings.get(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.ACCEPTED)
  publish(@Param('id', ParseIntPipe) id: number): Promise<ListingResponseDto> {
    return this.listings.publish(id);
  }

  @Post()
  create(@Body() body: CreateListingsDto): Promise<ListingResponseDto[]> {
    return this.listings.create(body);
  }
}

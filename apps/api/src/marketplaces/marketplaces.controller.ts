import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../generated/prisma/client.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { MarketplaceResponseDto, UpdateMarketplaceDto } from './dto/marketplace.dto.js';
import { MarketplacesService } from './marketplaces.service.js';

@ApiTags('marketplaces')
@ApiBearerAuth()
@Controller('marketplaces')
export class MarketplacesController {
  constructor(private readonly marketplaces: MarketplacesService) {}

  @Get()
  list(): Promise<MarketplaceResponseDto[]> {
    return this.marketplaces.list();
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateMarketplaceDto): Promise<MarketplaceResponseDto> {
    return this.marketplaces.update(id, body);
  }
}

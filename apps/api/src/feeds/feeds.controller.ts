import { Body, Controller, HttpCode, HttpStatus, ParseBoolPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { FeedsService, type ImportResult } from './feeds.service.js';

@ApiTags('feeds')
@ApiBearerAuth()
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  /**
   * Body: the CSV file itself (Content-Type: text/csv).
   * Columns: sku,title,category,cost_price,base_price,weight_kg,width_cm,height_cm,depth_cm[,ean][,stock]
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('text/csv')
  @ApiBody({ schema: { type: 'string', example: 'sku,title,category,cost_price,base_price,weight_kg,width_cm,height_cm,depth_cm,ean,stock' } })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean, description: 'Only check the file, change nothing' })
  import(
    @Body() csv: string,
    @CurrentUser() user: AuthUser,
    @Query('dryRun', new ParseBoolPipe({ optional: true })) dryRun = false,
  ): Promise<ImportResult> {
    return this.feeds.import(typeof csv === 'string' ? csv : '', user.id, dryRun);
  }
}

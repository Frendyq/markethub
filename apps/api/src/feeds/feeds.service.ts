import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StockMovementType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingClient, type FeedReport, type FeedRow } from '../pricing/pricing.client.js';
import { ListingSyncScheduler } from '../sync/listing-sync.scheduler.js';

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  errorRows: number;
  created: number;
  updated: number;
  errors: FeedReport['errors'];
}

const BATCH = 200;

/**
 * Supplier price list import.
 * The Rust pricing-engine parses and checks the CSV (all errors with line numbers);
 * valid rows are upserted by SKU in batches, each batch in its own transaction.
 * A "stock" column is a delivery: it is added to on-hand stock as a RECEIPT.
 */
@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingClient,
    private readonly scheduler: ListingSyncScheduler,
  ) {}

  async import(csv: string, userId: number, dryRun: boolean): Promise<ImportResult> {
    if (!csv || csv.trim().length === 0) {
      throw new BadRequestException('Send the CSV file as the request body with Content-Type: text/csv');
    }
    const report = await this.pricing.validateFeed(csv);
    const result: ImportResult = {
      dryRun,
      totalRows: report.totalRows,
      validRows: report.validRows,
      errorRows: report.errorRows,
      created: 0,
      updated: 0,
      errors: report.errors,
    };
    if (dryRun || report.rows.length === 0) {
      return result;
    }

    const touched: number[] = [];
    for (let start = 0; start < report.rows.length; start += BATCH) {
      const batch = report.rows.slice(start, start + BATCH);
      const counts = await this.prisma.$transaction(async (tx) => {
        let created = 0;
        const existing = new Map(
          (await tx.product.findMany({ where: { sku: { in: batch.map((r) => r.sku) } }, select: { id: true, sku: true } })).map(
            (p) => [p.sku, p.id],
          ),
        );
        for (const row of batch) {
          const fields = productFields(row);
          let productId = existing.get(row.sku);
          if (productId === undefined) {
            const product = await tx.product.create({ data: { sku: row.sku, ...fields, inventory: { create: { onHand: 0 } } } });
            productId = product.id;
            created += 1;
          } else {
            await tx.product.update({ where: { id: productId }, data: fields });
          }
          if (row.stock && row.stock > 0) {
            await tx.$executeRaw`UPDATE inventory SET on_hand = on_hand + ${row.stock}, updated_at = now() WHERE product_id = ${productId}`;
            await tx.stockMovement.create({
              data: { productId, type: StockMovementType.RECEIPT, quantity: row.stock, reason: `Price list, line ${row.line}`, userId },
            });
          }
          touched.push(productId);
        }
        return { created, updated: batch.length - created };
      });
      result.created += counts.created;
      result.updated += counts.updated;
    }

    await this.scheduler.scheduleProducts(touched, 'price list import');
    this.logger.log(`Price list: ${result.created} created, ${result.updated} updated, ${result.errorRows} rows with errors`);
    return result;
  }
}

function productFields(row: FeedRow) {
  return {
    title: row.title,
    category: row.category,
    ean: row.ean,
    costPrice: row.costPrice,
    basePrice: row.basePrice,
    weightKg: row.weightKg,
    widthCm: row.widthCm,
    heightCm: row.heightCm,
    depthCm: row.depthCm,
    isActive: true,
  };
}

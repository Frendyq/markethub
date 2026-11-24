-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('RESERVED', 'BACKORDERED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCEEDED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "marketplaces" ADD COLUMN     "orders_synced_until" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "order_id" INTEGER;

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "marketplace_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "currency" TEXT NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "customer_name" TEXT,
    "placed_at" TIMESTAMPTZ(3) NOT NULL,
    "shipped_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhooks" (
    "id" SERIAL NOT NULL,
    "marketplace_id" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" SERIAL NOT NULL,
    "marketplace_id" INTEGER,
    "listing_id" INTEGER,
    "job_name" TEXT NOT NULL,
    "job_id" TEXT,
    "status" "SyncStatus" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_marketplace_id_external_id_key" ON "orders"("marketplace_id", "external_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhooks_marketplace_id_event_id_key" ON "processed_webhooks"("marketplace_id", "event_id");

-- CreateIndex
CREATE INDEX "sync_runs_created_at_idx" ON "sync_runs"("created_at");

-- CreateIndex
CREATE INDEX "sync_runs_listing_id_idx" ON "sync_runs"("listing_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_marketplace_id_fkey" FOREIGN KEY ("marketplace_id") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_webhooks" ADD CONSTRAINT "processed_webhooks_marketplace_id_fkey" FOREIGN KEY ("marketplace_id") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

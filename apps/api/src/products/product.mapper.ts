import type { Inventory, Listing, Marketplace, Product } from '../generated/prisma/client.js';
import { money } from '../common/money.js';
import type { ProductDetailResponseDto, ProductResponseDto, StockDto } from './dto/product.dto.js';

export function toStock(inventory: Inventory | null | undefined): StockDto {
  const onHand = inventory?.onHand ?? 0;
  const reserved = inventory?.reserved ?? 0;
  return { onHand, reserved, available: onHand - reserved };
}

export function toProductResponse(product: Product & { inventory: Inventory | null }): ProductResponseDto {
  return {
    id: product.id,
    sku: product.sku,
    title: product.title,
    description: product.description,
    category: product.category,
    ean: product.ean,
    costPrice: money(product.costPrice),
    basePrice: money(product.basePrice),
    weightKg: product.weightKg.toFixed(3),
    widthCm: product.widthCm,
    heightCm: product.heightCm,
    depthCm: product.depthCm,
    imageUrl: product.imageUrl,
    location: product.location,
    isActive: product.isActive,
    stock: toStock(product.inventory),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function toProductDetail(
  product: Product & { inventory: Inventory | null; listings: (Listing & { marketplace: Marketplace })[] },
): ProductDetailResponseDto {
  return Object.assign(toProductResponse(product), {
    listings: product.listings.map((listing) => ({
      id: listing.id,
      marketplace: listing.marketplace.code,
      status: listing.status,
      price: money(listing.price),
      currency: listing.currency,
      quantity: listing.quantity,
      lastSyncedAt: listing.lastSyncedAt,
      lastError: listing.lastError,
    })),
  });
}

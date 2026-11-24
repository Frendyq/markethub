// Shapes of the MarketHub API responses used by the panel.

export type Role = 'ADMIN' | 'MANAGER';
export type ListingStatus = 'DRAFT' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ERROR';
export type OrderStatus = 'RESERVED' | 'BACKORDERED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface User {
  id: number;
  email: string;
  role: Role;
}

export interface Stock {
  onHand: number;
  reserved: number;
  available: number;
}

export interface Product {
  id: number;
  sku: string;
  title: string;
  description: string | null;
  category: string;
  ean: string | null;
  costPrice: string;
  basePrice: string;
  weightKg: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  isActive: boolean;
  stock: Stock;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListing {
  id: number;
  marketplace: string;
  status: ListingStatus;
  price: string | null;
  currency: string | null;
  quantity: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface ProductDetail extends Product {
  listings: ProductListing[];
}

export interface MarketplacePrice {
  marketplace: string;
  currency: string;
  price: string;
  vatAmount: string;
  feeAmount: string;
  proceedsEur: string;
  marginEur: string;
  marginPercent: string;
  belowMinMargin: boolean;
}

export interface Movement {
  id: number;
  type: 'RECEIPT' | 'ADJUSTMENT' | 'RESERVE' | 'RELEASE' | 'SHIPMENT';
  quantity: number;
  reason: string | null;
  userId: number | null;
  createdAt: string;
}

export interface Marketplace {
  id: number;
  code: string;
  name: string;
  country: string;
  currency: string;
  feePercent: string;
  vatPercent: string;
  rateLimitPerSec: number;
  isEnabled: boolean;
}

export interface Listing {
  id: number;
  productId: number;
  sku: string;
  title: string;
  marketplaceId: number;
  marketplace: string;
  status: ListingStatus;
  externalId: string | null;
  price: string | null;
  currency: string | null;
  quantity: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface Order {
  id: number;
  marketplace: string;
  externalId: string;
  status: OrderStatus;
  currency: string;
  totalAmount: string;
  customerName: string | null;
  placedAt: string;
  shippedAt: string | null;
  cancelledAt: string | null;
  items: { id: number; productId: number | null; sku: string; quantity: number; unitPrice: string }[];
}

export interface Dashboard {
  products: { total: number; active: number; lowStock: number; outOfStock: number };
  orders: { today: number; reserved: number; backordered: number; revenueToday: { currency: string; amount: string }[] };
  listings: Record<ListingStatus, number>;
  recentOrders: Order[];
  recentFailures: { id: number; marketplace: string | null; sku: string | null; error: string | null; createdAt: string }[];
}

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  errorRows: number;
  created: number;
  updated: number;
  errors: { line: number; sku: string | null; field: string; message: string }[];
}

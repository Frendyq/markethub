// Typed calls to the Rust side. The interface never uses fetch: every request, token and queued
// operation is handled in Rust (src-tauri/core).
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface AppInfo {
  serverUrl: string;
  signedIn: boolean;
  email: string | null;
  version: string;
}

export interface User {
  id: number;
  email: string;
  role: string;
}

export interface Line {
  productId: number | null;
  sku: string;
  title: string;
  ean: string | null;
  location: string | null;
  quantity: number;
  scanned: number;
}

export interface Order {
  id: number;
  marketplace: string;
  externalId: string;
  customerName: string | null;
  placedAt: string;
  lines: Line[];
  units: number;
  scannedUnits: number;
  complete: boolean;
}

export interface PickingView {
  orders: Order[];
  offline: boolean;
}

export type ScanOutcome =
  | { result: 'matched'; sku: string; title: string; scanned: number; needed: number }
  | { result: 'alreadyComplete'; sku: string; title: string }
  | { result: 'notInOrder' }
  | { result: 'invalidCode' };

export interface ScanView {
  outcome: ScanOutcome;
  order: Order;
}

export interface Product {
  id: number;
  sku: string;
  title: string;
  ean: string | null;
  location: string | null;
  category: string;
  stock: { onHand: number; reserved: number; available: number };
}

export interface OutboxItem {
  id: string;
  label: string;
  status: 'pending' | 'conflict';
  attempts: number;
  lastError: string | null;
  createdAt: number;
  nextAttemptAt: number;
}

export interface SyncStatus {
  pending: number;
  conflicts: number;
  online: boolean;
  signedIn: boolean;
  lastError: string | null;
}

/** What a failed command rejects with (see AppError in Rust). */
export interface AppError {
  kind: 'api' | 'offline' | 'unauthorized' | 'storage' | 'vault' | 'invalid' | 'not_found';
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;
}

export function errorMessage(error: unknown): string {
  return isAppError(error) ? error.message : String(error);
}

export const api = {
  appInfo: () => invoke<AppInfo>('app_info'),
  setServerUrl: (url: string) => invoke<void>('set_server_url', { url }),
  login: (email: string, password: string) => invoke<User>('login', { email, password }),
  logout: () => invoke<void>('logout'),

  pickingList: () => invoke<PickingView>('picking_list'),
  pickingOrder: (orderId: number) => invoke<Order>('picking_order', { orderId }),
  scanCode: (orderId: number, code: string) => invoke<ScanView>('scan_code', { orderId, code }),
  resetScans: (orderId: number) => invoke<Order>('reset_scans', { orderId }),
  shipOrder: (orderId: number) => invoke<OutboxItem>('ship_order', { orderId }),
  shippingLabel: (orderId: number) => invoke<string>('shipping_label', { orderId }),

  findProduct: (code: string) => invoke<Product>('find_product', { code }),
  receiveStock: (productId: number, sku: string, quantity: number, note: string) =>
    invoke<OutboxItem>('receive_stock', { productId, sku, quantity, note }),
  countStock: (productId: number, sku: string, counted: number, onHand: number) =>
    invoke<OutboxItem | null>('count_stock', { productId, sku, counted, onHand }),

  syncStatus: () => invoke<SyncStatus>('sync_status'),
  outbox: () => invoke<OutboxItem[]>('outbox'),
  retryOperation: (id: string) => invoke<boolean>('retry_operation', { id }),
  discardOperation: (id: string) => invoke<boolean>('discard_operation', { id }),
  syncNow: () => invoke<void>('sync_now'),
};

export function onSyncStatus(handler: (status: SyncStatus) => void): Promise<UnlistenFn> {
  return listen<SyncStatus>('sync-status', (event) => handler(event.payload));
}

export const MARKETPLACES: Record<string, string> = { amazon: 'Amazon', ebay: 'eBay', otto: 'OTTO', kaufland: 'Kaufland' };

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Walks through the whole panel like a manager would, against a running stack:
 * API, worker, pricing-engine and mock marketplaces must be up (docker compose --profile app up).
 * It creates its own product with a unique SKU, so it can run on a database with demo data.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:3002';
const ADMIN = { email: 'admin@markethub.local', password: 'admin12345' };

const run = Date.now().toString(36).toUpperCase();
const SKU = `E2E-${run}`;
const TITLE = `E2E desk ${run}`;

test.describe.configure({ mode: 'serial' });

let page: Page;
let productId: number;

async function apiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, { data: ADMIN });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken;
}

/** Waits until the mock marketplace has received our product (the worker pushed it). */
async function waitForMockListing(request: APIRequestContext, marketplace: string) {
  await expect
    .poll(
      async () => {
        const state = await (await request.get(`${MOCK_URL}/_admin/state`)).json();
        return (state.listings[marketplace] ?? []).some((l: { sku: string }) => l.sku === SKU);
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
}

test.beforeAll(async ({ browser, request }) => {
  // Errors and random customer orders off for this run: here we want a fast, predictable path.
  await request.post(`${MOCK_URL}/_admin/chaos`, { data: { failRate: 0, autoOrders: false } });

  const token = await apiToken(request);
  const created = await request.post(`${API_URL}/api/products`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      sku: SKU,
      title: TITLE,
      category: 'desks',
      costPrice: '120.00',
      basePrice: '299.00',
      weightKg: '25',
      widthCm: 140,
      heightCm: 75,
      depthCm: 70,
      initialStock: 4,
    },
  });
  expect(created.status()).toBe(201);
  productId = (await created.json()).id;
  page = await browser.newPage();
});

test.afterAll(async ({ request }) => {
  await request.post(`${MOCK_URL}/_admin/chaos`, { data: { failRate: 0.15, autoOrders: true } });
  await page.close();
});

test('rejects a wrong password and signs in with the right one', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong email or password')).toBeVisible();

  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText(ADMIN.email)).toBeVisible();
});

test('opens every section from the sidebar', async () => {
  for (const [link, heading] of [
    ['Products', 'Products'],
    ['Listings', 'Listings'],
    ['Orders', 'Orders'],
    ['Price list import', 'Price list import'],
    ['Overview', 'Overview'],
  ]) {
    await page.getByRole('navigation').getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Queues ↗' })).toHaveAttribute('href', /\/api\/admin\/queues$/);
});

test('finds the product by search and opens it', async () => {
  await page.goto('/products');
  await page.getByPlaceholder('Search title or SKU').fill(SKU);
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.getByRole('row')).toHaveCount(2); // header + our product
  await page.getByRole('link', { name: TITLE }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(TITLE));
});

test('shows a price per marketplace from the Rust service', async () => {
  const prices = page.locator('section', { hasText: 'Price per marketplace' });
  for (const name of ['Amazon', 'eBay', 'OTTO', 'Kaufland']) {
    await expect(prices.getByRole('cell', { name, exact: true })).toBeVisible();
  }
  await expect(prices.getByText(/€[\d,]+\.99/).first()).toBeVisible();
});

test('books a stock receipt and refuses a correction below zero', async () => {
  const stock = page.locator('section', { hasText: 'On hand' });
  await stock.getByPlaceholder('+5 or -2').fill('3');
  await stock.getByPlaceholder('Delivery, stock count…').fill('e2e delivery');
  await stock.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Marketplaces will get the new quantity in a moment.')).toBeVisible();
  await expect(stock.getByText('7', { exact: true })).toHaveCount(2); // on hand and available

  await stock.getByRole('combobox').selectOption('ADJUSTMENT');
  await stock.getByPlaceholder('+5 or -2').fill('-100');
  await stock.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Stock would drop below the reserved quantity')).toBeVisible();

  await expect(page.getByRole('cell', { name: 'e2e delivery' })).toBeVisible();
});

test('lists the product on every marketplace and the worker pushes it', async ({ request }) => {
  await page.getByRole('button', { name: 'List on all marketplaces' }).click();
  await expect(page.getByRole('button', { name: 'Push now' })).toHaveCount(4);

  for (const marketplace of ['amazon', 'ebay', 'otto', 'kaufland']) {
    await waitForMockListing(request, marketplace);
  }
  // No reload: the page refreshes itself while listings are pending.
  const listings = page.locator('table').filter({ hasText: 'Last sync' });
  await expect(listings.getByText('active', { exact: true })).toHaveCount(4);
  await expect(listings.getByRole('cell', { name: '7', exact: true })).toHaveCount(4);

  await listings.getByRole('button', { name: 'Push now' }).first().click();
  await expect(listings.getByText('Queued')).toBeVisible();
});

test('filters listings by marketplace and status', async () => {
  await page.goto('/listings');
  await page.getByRole('link', { name: 'OTTO Market' }).click();
  await expect(page).toHaveURL(/marketplaceId=/);
  await page.getByRole('link', { name: 'active', exact: true }).click();
  await expect(page).toHaveURL(/status=ACTIVE/);
  await expect(page.getByRole('link', { name: TITLE }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Any status' }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByRole('link', { name: 'All marketplaces' }).click();
  await expect(page).toHaveURL(/\/listings\??$/);
});

test('an order from a marketplace reserves stock, then ships and gets delivered', async ({ request }) => {
  const created = await request.post(`${MOCK_URL}/_admin/orders`, { data: { marketplace: 'otto', sku: SKU, quantity: 2 } });
  expect(created.status()).toBe(201);
  const orderNumber = (await created.json()).id as string;

  await page.goto('/orders?status=RESERVED');
  const row = page.getByRole('row', { name: new RegExp(orderNumber) });
  await expect(row).toBeVisible();
  await expect(row.getByText('reserved', { exact: true })).toBeVisible();

  await page.goto(`/products/${productId}`);
  const stock = page.locator('section', { hasText: 'On hand' });
  await expect(stock.getByText('5', { exact: true })).toBeVisible(); // available: 7 - 2

  await page.goto('/orders');
  await page.getByPlaceholder('Order number or customer').fill(orderNumber);
  await page.getByRole('button', { name: 'Search' }).click();
  const found = page.getByRole('row', { name: new RegExp(orderNumber) });
  await found.getByRole('button', { name: 'Ship' }).click();
  await expect(found.getByText('shipped', { exact: true })).toBeVisible();
  await found.getByRole('button', { name: 'Delivered' }).click();
  await expect(found.getByText('delivered', { exact: true })).toBeVisible();
});

test('cancelling asks first, and "No" keeps the order', async ({ request }) => {
  const created = await request.post(`${MOCK_URL}/_admin/orders`, { data: { marketplace: 'amazon', sku: SKU, quantity: 1 } });
  const orderNumber = (await created.json()).id as string;

  await page.goto(`/orders?search=${orderNumber}`);
  const row = page.getByRole('row', { name: new RegExp(orderNumber) });
  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByText('Cancel the order?')).toBeVisible();
  await row.getByRole('button', { name: 'No' }).click();
  await expect(row.getByText('reserved', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'Cancel' }).click();
  await row.getByRole('button', { name: 'Yes' }).click();
  await expect(row.getByText('cancelled', { exact: true })).toBeVisible();
});

test('a backordered order can be reserved after a delivery', async ({ request }) => {
  const created = await request.post(`${MOCK_URL}/_admin/orders`, { data: { marketplace: 'kaufland', sku: SKU, quantity: 9 } });
  const orderNumber = (await created.json()).id as string;

  await page.goto(`/orders?search=${orderNumber}`);
  const row = page.getByRole('row', { name: new RegExp(orderNumber) });
  await expect(row.getByText('backordered', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Reserve' }).click();
  await expect(row.getByText('Still not enough stock for this order')).toBeVisible();

  const token = await apiToken(request);
  await request.post(`${API_URL}/api/inventory/${productId}/movements`, {
    headers: { authorization: `Bearer ${token}` },
    data: { type: 'RECEIPT', quantity: 10, reason: 'e2e restock' },
  });
  await row.getByRole('button', { name: 'Reserve' }).click();
  await expect(row.getByText('reserved', { exact: true })).toBeVisible();
});

test('filters orders by status', async () => {
  await page.goto('/orders');
  for (const status of ['reserved', 'backordered', 'shipped', 'delivered', 'cancelled']) {
    await page.getByRole('link', { name: status, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`status=${status.toUpperCase()}`));
  }
  await page.getByRole('link', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
});

test('checks a price list and shows every bad row', async () => {
  await page.goto('/import');
  const csv = [
    'sku,title,category,cost_price,base_price,weight_kg,width_cm,height_cm,depth_cm,ean,stock',
    `${SKU},${TITLE},desks,120,299,25,140,75,70,,`,
    'x,,desks,-1,10,1,0,75,70,123,',
  ].join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Check only' }).click();
  await expect(page.getByText(/Checked: 2 rows/)).toBeVisible();
  for (const field of ['sku', 'title', 'cost_price', 'width_cm', 'ean']) {
    await expect(page.getByRole('cell', { name: field, exact: true })).toBeVisible();
  }
});

test('imports a price list and updates the catalog', async () => {
  const csv = [
    'sku,title,category,cost_price,base_price,weight_kg,width_cm,height_cm,depth_cm,ean,stock',
    `${SKU},${TITLE} v2,desks,120,319,25,140,75,70,,1`,
  ].join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/Imported: 1 rows/)).toBeVisible();
  await expect(page.getByText('0 new products, 1 updated.')).toBeVisible();
  // The chosen file stays after the import, so it can be checked and imported without picking it again.
  await expect(page.locator('input[type=file]')).toHaveValue(/prices.csv/);

  await page.goto(`/products/${productId}`);
  await expect(page.getByRole('heading', { name: `${TITLE} v2` })).toBeVisible();
  await expect(page.getByText('€319.00')).toBeVisible();
});

test('archiving asks first and hides the product on the marketplaces', async () => {
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText(/· archived/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List on all marketplaces' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
  await expect(page.getByText(/· archived/)).toHaveCount(0);
});

test('the overview shows the day and the latest orders', async () => {
  await page.goto('/');
  await expect(page.getByText('Orders today')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest orders' })).toBeVisible();
  await page.getByRole('link', { name: 'active' }).first().click();
  await expect(page).toHaveURL(/\/listings\?status=ACTIVE/);
});

test('signs out and the panel is closed again', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login$/);
});

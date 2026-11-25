// Prepares a fresh MarketHub for a demo: publishes some products on all marketplaces,
// so the mock marketplaces have listings, start sending orders, and the panel is not empty.
//
//   node scripts/demo-warmup.mjs            (API at http://localhost:3000)
//   API_URL=http://host:3000 node scripts/demo-warmup.mjs 20
//
// Safe to run again: listing a product twice changes nothing.

const API = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const COUNT = Number(process.argv[2] ?? 12);
const EMAIL = process.env.DEMO_EMAIL ?? 'admin@markethub.local';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'admin12345';

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const { accessToken: token } = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
const { items } = await call('/products?limit=100&isActive=true', { token });

// A few with plenty of stock (normal sales) and two with 1-2 units (good for the "last item" demo).
const plenty = items.filter((p) => p.stock.available >= 5).slice(0, Math.max(0, COUNT - 2));
const scarce = items.filter((p) => p.stock.available >= 1 && p.stock.available <= 2).slice(0, 2);
const chosen = [...plenty, ...scarce];

for (const product of chosen) {
  await call('/listings', { token, method: 'POST', body: { productId: product.id, publish: true } });
}
console.log(`Published ${chosen.length} products on all marketplaces:`);
for (const p of chosen) {
  console.log(`  ${p.sku.padEnd(22)} available ${String(p.stock.available).padStart(3)}  ${p.location ?? ''}`);
}

// Wait until the worker has pushed everything (PENDING -> ACTIVE/PAUSED, or ERROR after retries).
for (let attempt = 0; attempt < 60; attempt++) {
  const pending = (await call('/listings?status=PENDING&limit=1', { token })).total;
  if (pending === 0) {
    const active = (await call('/listings?status=ACTIVE&limit=1', { token })).total;
    const errors = (await call('/listings?status=ERROR&limit=1', { token })).total;
    console.log(`Done: ${active} listings active, ${errors} in error. Orders start arriving every ~20 s.`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log('Some listings are still pending: is the worker running?');
process.exit(1);

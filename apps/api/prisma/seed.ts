/**
 * Demo data: four marketplaces, exchange rates, two users and a furniture catalog.
 * Safe to run more than once: everything is upserted by its natural key.
 *
 * Demo sign-in (local development only):
 *   admin@markethub.local   / admin12345   (ADMIN)
 *   manager@markethub.local / manager12345 (MANAGER)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient, Role, StockMovementType } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const marketplaces = [
  { code: 'amazon', name: 'Amazon.de', country: 'DE', currency: 'EUR', feePercent: '15.00', vatPercent: '19.00', rateLimitPerSec: 5 },
  { code: 'ebay', name: 'eBay.com', country: 'US', currency: 'USD', feePercent: '13.25', vatPercent: '0.00', rateLimitPerSec: 4 },
  { code: 'otto', name: 'OTTO Market', country: 'DE', currency: 'EUR', feePercent: '14.00', vatPercent: '19.00', rateLimitPerSec: 3 },
  { code: 'kaufland', name: 'Kaufland.de', country: 'DE', currency: 'EUR', feePercent: '12.00', vatPercent: '19.00', rateLimitPerSec: 3 },
];

const rates = [
  { currency: 'EUR', perEur: '1.000000' },
  { currency: 'USD', perEur: '1.080000' },
  { currency: 'GBP', perEur: '0.850000' },
  { currency: 'KZT', perEur: '560.000000' },
];

// [category, model names, base price range in EUR, weight range kg, dimensions w/h/d cm]
const families: [string, string[], [number, number], [number, number], [number, number, number]][] = [
  ['sofas', ['Oslo', 'Bergen', 'Malmo', 'Lund', 'Turku'], [499, 1499], [38, 75], [210, 85, 95]],
  ['beds', ['Nordic', 'Alba', 'Siena', 'Verona'], [349, 1199], [45, 90], [160, 100, 210]],
  ['wardrobes', ['Linea', 'Forma', 'Kubik', 'Atlas'], [299, 999], [60, 140], [150, 220, 60]],
  ['tables', ['Rustic', 'Loft', 'Oval', 'Milano', 'Tokio'], [149, 799], [18, 55], [160, 76, 90]],
  ['chairs', ['Bistro', 'Scandi', 'Velvet', 'Wire', 'Office Pro'], [39, 249], [4, 16], [48, 85, 52]],
  ['desks', ['Studio', 'Work+', 'Corner'], [129, 549], [20, 48], [140, 75, 70]],
  ['shelves', ['Grid', 'Ladder', 'Cube'], [59, 299], [8, 35], [80, 180, 35]],
  ['mattresses', ['Cloud', 'Firm', 'Hybrid', 'Kids'], [129, 699], [12, 32], [160, 24, 200]],
];
const colors = ['GRY', 'BEI', 'BLK', 'WHT', 'OAK'];
const colorNames: Record<string, string> = { GRY: 'grey', BEI: 'beige', BLK: 'black', WHT: 'white', OAK: 'oak' };

function lerp(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

function ean13(seed: number): string {
  const body = `400${String(1_000_000_000 + seed * 7919).slice(-9)}`;
  const sum = body.split('').reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return body + String((10 - (sum % 10)) % 10);
}

async function main(): Promise<void> {
  for (const m of marketplaces) {
    await prisma.marketplace.upsert({ where: { code: m.code }, update: {}, create: m });
  }
  for (const r of rates) {
    await prisma.exchangeRate.upsert({ where: { currency: r.currency }, update: { perEur: r.perEur }, create: r });
  }

  const users = [
    { email: 'admin@markethub.local', name: 'Admin', password: 'admin12345', role: Role.ADMIN },
    { email: 'manager@markethub.local', name: 'Manager', password: 'manager12345', role: Role.MANAGER },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash: await argon2.hash(u.password) },
    });
  }

  let n = 0;
  for (const [category, models, priceRange, weightRange, [w, h, d]] of families) {
    for (const [i, model] of models.entries()) {
      n += 1;
      const color = colors[(n + i) % colors.length];
      const t = models.length === 1 ? 0.5 : i / (models.length - 1);
      const basePrice = Math.round(lerp(priceRange, t)) + 0.99 - 1; // 498.99-like prices
      const sku = `${category.slice(0, 3).toUpperCase()}-${model.toUpperCase().replace(/[^A-Z0-9]/g, '')}-${color}`;
      const onHand = (n * 7) % 23; // a few products end up with 0-2 units: useful for low-stock demos

      const existing = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
      if (existing) {
        continue;
      }
      await prisma.product.create({
        data: {
          sku,
          title: `${model} ${category.replace(/s$/, '')}, ${colorNames[color]}`,
          description: `${model} from the ${category} collection. Flat-packed, assembly instructions included.`,
          category,
          ean: ean13(n),
          costPrice: (basePrice * 0.48).toFixed(2),
          basePrice: basePrice.toFixed(2),
          weightKg: lerp(weightRange, t).toFixed(3),
          widthCm: w,
          heightCm: h,
          depthCm: d,
          inventory: { create: { onHand } },
          stockMovements: onHand > 0 ? { create: { type: StockMovementType.RECEIPT, quantity: onHand, reason: 'Seed' } } : undefined,
        },
      });
    }
  }

  // Warehouse locations: one aisle per category (A, B, ...), rack and shelf from the product id.
  const categories = families.map(([category]) => category);
  const unplaced = await prisma.product.findMany({ where: { location: null }, select: { id: true, category: true } });
  for (const p of unplaced) {
    const aisle = String.fromCharCode(65 + Math.max(0, categories.indexOf(p.category)) % 26);
    const location = `${aisle}-${String((p.id % 12) + 1).padStart(2, '0')}-${(p.id % 4) + 1}`;
    await prisma.product.update({ where: { id: p.id }, data: { location } });
  }

  const productCount = await prisma.product.count();
  console.log(`Seeded ${marketplaces.length} marketplaces, ${users.length} users, ${productCount} products`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

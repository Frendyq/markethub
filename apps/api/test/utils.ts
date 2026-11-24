import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: ['error', 'warn'] });
  configureApp(app, 'http://localhost:3001');
  await app.init();
  return { app, prisma: app.get(PrismaService), http: () => request(app.getHttpServer()) };
}

export const ADMIN = { email: 'admin@test.local', password: 'admin-pass-123' };
export const MANAGER = { email: 'manager@test.local', password: 'manager-pass-123' };

/** Empties every table and inserts the minimum: two users and four marketplaces. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  // Low cost parameters: these hashes only need to be valid, not slow.
  const hash = (plain: string) => argon2.hash(plain, { timeCost: 2, memoryCost: 4096 });
  await prisma.user.createMany({
    data: [
      { email: ADMIN.email, name: 'Admin', role: Role.ADMIN, passwordHash: await hash(ADMIN.password) },
      { email: MANAGER.email, name: 'Manager', role: Role.MANAGER, passwordHash: await hash(MANAGER.password) },
    ],
  });
  await prisma.marketplace.createMany({
    data: [
      { code: 'amazon', name: 'Amazon.de', country: 'DE', currency: 'EUR', feePercent: '15', vatPercent: '19' },
      { code: 'ebay', name: 'eBay.com', country: 'US', currency: 'USD', feePercent: '13.25', vatPercent: '0' },
      { code: 'otto', name: 'OTTO Market', country: 'DE', currency: 'EUR', feePercent: '14', vatPercent: '19' },
      { code: 'kaufland', name: 'Kaufland.de', country: 'DE', currency: 'EUR', feePercent: '12', vatPercent: '19', isEnabled: false },
    ],
  });
  await prisma.exchangeRate.createMany({
    data: [
      { currency: 'EUR', perEur: '1' },
      { currency: 'USD', perEur: '1.08' },
    ],
  });
}

export async function signIn(ctx: TestContext, who: { email: string; password: string }): Promise<string> {
  const res = await ctx.http().post('/api/auth/login').send(who).expect(200);
  return res.body.accessToken as string;
}

export const sampleProduct = (overrides: Record<string, unknown> = {}) => ({
  sku: 'TAB-TEST-OAK',
  title: 'Test table, oak',
  category: 'tables',
  costPrice: '100.00',
  basePrice: '249.99',
  weightKg: '20.500',
  widthCm: 120,
  heightCm: 75,
  depthCm: 70,
  initialStock: 5,
  ...overrides,
});

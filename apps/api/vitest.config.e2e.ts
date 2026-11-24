import { defineConfig } from 'vitest/config';

// e2e tests run the whole app against a separate database (markethub_test).
// Files run one after another because they share that database.
export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://markethub:markethub@localhost:5433/markethub_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-0123456789',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789-0123456789',
  WEBHOOK_SECRET: 'test-webhook-secret',
  // 0: the reuse test below must see theft detection right away.
  REFRESH_REUSE_GRACE_SECONDS: '0',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  PRICING_ENGINE_URL: 'http://localhost:8080',
  MARKETPLACES_URL: 'http://localhost:3002',
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: testEnv,
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

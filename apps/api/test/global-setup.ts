import { execSync } from 'node:child_process';

/** Brings the test database to the latest migration once before all e2e files. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://markethub:markethub@localhost:5433/markethub_test';
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

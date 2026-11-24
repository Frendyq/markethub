import { defineConfig, devices } from '@playwright/test';

/**
 * Clicks through the panel against a running stack (`docker compose --profile app up`,
 * or the dev servers). PANEL_URL and MOCK_URL point at it.
 * Locally it uses the installed Chrome (PW_CHANNEL=chrome); CI installs Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PANEL_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined, viewport: { width: 1400, height: 900 } },
    },
  ],
});

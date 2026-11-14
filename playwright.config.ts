import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // No Docker: starts the app on its own MongoDB with the showcase seed (scripts/stack.mjs), or
  // reuses one already running on the site port (`npm start`, `npm run dev`).
  webServer: {
    command: 'node scripts/stack.mjs',
    url: process.env['E2E_SITE'] ?? 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 5 * 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
  use: {
    baseURL: process.env['E2E_SITE'] ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});

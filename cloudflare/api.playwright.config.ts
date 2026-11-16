import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../tests',
  testMatch: 'api.spec.ts',
  workers: 1,
  timeout: 45000,
  use: { browserName: 'chromium', headless: true },
  reporter: 'list',
});

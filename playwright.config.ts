import { defineConfig, devices } from '@playwright/test';

for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[name];
const base=process.env.PLAYWRIGHT_BASE_URL||'http://localhost:8793';
process.env.API_BASE_URL=base;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: base,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Chromium mobile emulation also exposes CDP's real virtual WebAuthn device.
  // iPhone 15's CSS viewport is identical to Playwright's iPhone 13 descriptor.
  projects: ['light', 'dark'].map(colorScheme => ({
    name: `iPhone15-${colorScheme}`,
    use: {
      ...devices['iPhone 13'],
      defaultBrowserType: 'chromium' as const,
      browserName: 'chromium' as const,
      viewport: { width: 393, height: 852 },
      colorScheme: colorScheme as 'light' | 'dark',
    },
  })),
  webServer: {
    command: 'npm run build && WRANGLER_SEND_METRICS=false npx wrangler dev --local --port '+new URL(base).port+' --persist-to .wrangler/e2e-'+new URL(base).port+' --var SESSION_SECRET:byheart-playwright-local-only-secret-32chars',
    url: base+'/api/config',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

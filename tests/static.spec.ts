import { test, expect } from '@playwright/test';

test('N5/N6/N18 real asset binding preserves headers and missing static status', async ({
  request,
}) => {
  for (const path of [
    '/',
    '/gallery',
    '/api/config',
    '/sw.js',
    '/content/bsb/jhn.json',
    '/content/bsb/nope.json',
    '/assets/nope.js',
    '/.env',
  ]) {
    const response = await request.get(path, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    expect(response.headers()['strict-transport-security'], path).toBe('max-age=31536000');
    if (['/content/bsb/nope.json', '/assets/nope.js', '/.env'].includes(path)) {
      expect(response.status(), path).toBe(404);
      expect(await response.text()).not.toContain('<!doctype html>');
    } else expect(response.ok(), path).toBe(true);
    if (['/', '/gallery'].includes(path)) {
      expect(response.headers()['cache-control']).toContain('no-transform');
      expect(response.headers()['content-security-policy']).toContain("script-src 'self';");
      expect(await response.text()).not.toContain('cloudflareinsights');
    }
  }
});

test('N17 service worker caches only WOFF2 Latin fonts and N18 never caches missing books', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  const fonts = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    )
      .flat()
      .filter((path) => /\.(woff2?|ttf|otf)$/.test(path)),
  );
  expect(fonts).toHaveLength(12);
  expect(fonts.every((path) => /-latin(?:-ext)?-.*\.woff2$/.test(path))).toBe(true);
  const result = await page.evaluate(async () => {
    const response = await fetch('/content/bsb/nope.json');
    return {
      status: response.status,
      body: await response.text(),
      cached: !!(await caches.match('/content/bsb/nope.json')),
    };
  });
  expect(result.status).toBe(404);
  expect(result.body).not.toContain('<!doctype html>');
  expect(result.cached).toBe(false);
});

test('N18 missing book displays a friendly recoverable message', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ serviceWorkers: 'block', baseURL });
  const page = await context.newPage();
  try {
    await context.route('**/content/bsb/isa.json', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }),
    );
    await page.goto('/');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Discover', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add your own', exact: true }).click();
    await page.getByLabel('Bible reference').fill('Isaiah 1:1');
    await page.getByRole('button', { name: 'Find verses', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(
      "This book isn't saved on this device yet. Connect once to download it.",
    );
  } finally {
    await context.close();
  }
});

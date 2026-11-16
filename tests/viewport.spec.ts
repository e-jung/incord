import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function fieldSizes(page: Page) {
  const fields = page.locator('input, select, textarea');
  expect(await fields.count()).toBeGreaterThan(0);
  const sizes = await fields.evaluateAll((nodes) =>
    nodes.map((node) => ({
      tag: node.tagName,
      type: node.getAttribute('type'),
      size: parseFloat(getComputedStyle(node).fontSize),
    })),
  );
  for (const field of sizes) expect(field.size, JSON.stringify(field)).toBeGreaterThanOrEqual(16);
  return sizes;
}

test('viewport and cancelable WebKit gestures prevent pinch without suppressing scrolling or taps', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account settings', exact: true })).toBeVisible();
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  const directives = Object.fromEntries(
    viewport!.split(',').map((value) => value.trim().split('=')),
  );
  expect(directives).toMatchObject({
    width: 'device-width',
    'initial-scale': '1',
    'maximum-scale': '1',
    'viewport-fit': 'cover',
  });
  const events = await page.evaluate(() =>
    ['gesturestart', 'gesturechange', 'touchmove', 'click'].map((type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const accepted = document.getElementById('app')!.dispatchEvent(event);
      return { type, accepted, prevented: event.defaultPrevented };
    }),
  );
  expect(events).toEqual([
    { type: 'gesturestart', accepted: false, prevented: true },
    { type: 'gesturechange', accepted: false, prevented: true },
    { type: 'touchmove', accepted: true, prevented: false },
    { type: 'click', accepted: true, prevented: false },
  ]);
  expect(await page.locator('html').evaluate((node) => getComputedStyle(node).touchAction)).toBe(
    'pan-x pan-y',
  );
  expect(await page.locator('body').evaluate((node) => getComputedStyle(node).touchAction)).toBe(
    'pan-x pan-y',
  );
  const button = page.getByRole('button', { name: 'Account settings', exact: true });
  expect(await button.evaluate((node) => getComputedStyle(node).touchAction)).toBe('manipulation');
  await button.click();
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toBeVisible();
});

test('all live form fields keep the iOS 16px floor and follow text size and root text scaling', async ({
  page,
}) => {
  await page.goto('/');
  const settingsSizes: number[] = [];
  for (const size of ['small', 'default', 'large', 'extra-large']) {
    await page.getByRole('button', { name: 'Account settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption(size);
    await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
    const settings = await fieldSizes(page);
    expect(settings.some((field) => field.tag === 'TEXTAREA')).toBe(true);
    expect(settings.some((field) => field.type === 'time')).toBe(true);
    settingsSizes.push(
      await page
        .getByRole('combobox', { name: 'Text size', exact: true })
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    );
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Discover', exact: true })
      .click();
    await fieldSizes(page);
    await page.getByRole('button', { name: 'Add your own', exact: true }).click();
    await page.getByRole('button', { name: 'Your text', exact: true }).click();
    await expect(page.getByLabel('Text to remember')).toBeVisible();
    await fieldSizes(page);
  }
  expect(settingsSizes[2]).toBeGreaterThan(settingsSizes[1]);
  expect(settingsSizes[3]).toBeGreaterThan(settingsSizes[2]);
  const field = page.getByLabel('Text to remember');
  const before = await field.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  await page.locator('html').evaluate((node) => {
    node.style.fontSize = '24px';
  });
  expect(
    await field.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeGreaterThan(before);
  await fieldSizes(page);
  await field.fill('Grace and peace.');
  await expect(field).toHaveValue('Grace and peace.');
});

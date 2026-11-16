import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const shots = 'test-results/screens/qa5';
async function shot(page: Page, info: TestInfo, name: string) {
  await mkdir(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${shots}/${info.project.name}-${name}.png`,
    animations: 'disabled',
  });
}
async function documents(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Catechisms & creeds', exact: true }).click();
}
test('inline success statuses expire near the action and never follow navigation into practice', async ({
  page,
}, info) => {
  await documents(page);
  await page
    .locator('.document-cards')
    .getByRole('button')
    .filter({ has: page.locator('b', { hasText: 'Westminster Shorter Catechism' }) })
    .click();
  await page.clock.install();
  await page.getByRole('button', { name: 'Add Q1', exact: true }).click();
  const feedback = page.getByRole('status').filter({ hasText: /^1 item added to your library\.$/ });
  await expect(feedback).toBeVisible();
  await feedback.scrollIntoViewIfNeeded();
  const notification = (await feedback.boundingBox())!;
  const content = (await page.locator('.page').boundingBox())!;
  const nav = (await page.getByRole('navigation').boundingBox())!;
  expect(notification.y).toBeGreaterThanOrEqual(content.y);
  expect(notification.y + notification.height).toBeLessThanOrEqual(content.y + content.height);
  expect(await feedback.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  await expect(page.locator('.added-toast')).toHaveCount(0);
  expect(notification.y + notification.height).toBeLessThanOrEqual(nav.y);
  await shot(page, info, 'inline-success');
  await page.clock.fastForward(1000);
  await expect(feedback).toBeVisible();
  await page.clock.fastForward(3000);
  await expect(feedback).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Q2', exact: true }).click();
  await expect(feedback).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(feedback).toHaveCount(0);
  await page.clock.resume();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.locator('.practice')).toBeVisible();
  await expect(page.locator('.added-toast,.undo-toast')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: /items? added to your library\./ }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show numbers', exact: true })).toHaveCount(0);
  await expect(page.locator('.keyboard .keyrow')).toHaveCount(3);
  await shot(page, info, 'catechism-step-1');
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect(feedback).toHaveCount(0);
});
test('numeric tokens have a reversible digit keyboard with three rows and full-height targets', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Add your own', exact: true }).click();
  await page.getByRole('button', { name: 'Your text', exact: true }).click();
  await page.getByLabel('Title or question').fill('Count the gifts');
  await page.getByLabel('Text to remember').fill('Give 12 thanks.');
  await page.getByRole('button', { name: 'Add your text', exact: true }).click();
  await expect(page.locator('.action-feedback[role="status"]')).toHaveText(
    '1 item added to your library.',
  );
  await page.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /^My texts/ }).click();
  await page
    .getByRole('button')
    .filter({ has: page.locator('b', { hasText: 'Count the gifts' }) })
    .click();
  const keyboard = page.getByLabel('Practice keyboard');
  await expect(keyboard.locator('.keyrow')).toHaveCount(3);
  const numberToggle = keyboard.getByRole('button', { name: 'Show numbers', exact: true });
  await expect(keyboard.locator('.keyrow').nth(2).getByRole('button').first()).toHaveAccessibleName(
    'Show numbers',
  );
  const toggleBox = (await numberToggle.boundingBox())!,
    zBox = (await keyboard.getByRole('button', { name: 'Z', exact: true }).boundingBox())!;
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(zBox.x);
  const height = (await keyboard.boundingBox())!.height;
  expect(height).toBeLessThan(250);
  await expect(page.locator('.added-toast,.undo-toast')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: /items? added to your library\./ }),
  ).toHaveCount(0);
  await shot(page, info, 'numeric-letters');
  await keyboard.getByRole('button', { name: 'G', exact: true }).click();
  await keyboard.getByRole('button', { name: 'Show numbers', exact: true }).click();
  await expect(keyboard.locator('.number-key')).toHaveCount(10);
  await expect(keyboard.locator('.keyrow')).toHaveCount(3);
  await expect(keyboard.locator('.keyrow').nth(2).getByRole('button').first()).toHaveAccessibleName(
    'Show letters',
  );
  expect((await keyboard.boundingBox())!.height).toBe(height);
  for (const button of await keyboard.getByRole('button').all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, info, 'numeric-digits');
  await keyboard.getByRole('button', { name: '1', exact: true }).click();
  await expect(page.locator('[data-word="2"]')).toHaveClass(/current/);
  await keyboard.getByRole('button', { name: 'Show letters', exact: true }).click();
  await expect(keyboard.locator('.number-key')).toHaveCount(0);
  await keyboard.getByRole('button', { name: 'T', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Step 1 passed', exact: true })).toBeVisible();
  await expect(page.locator('.added-toast,.undo-toast')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: /items? added to your library\./ }),
  ).toHaveCount(0);
});
test('document cards offer whole-document or inclusive range selection', async ({ page }, info) => {
  await documents(page);
  for (const [label, name] of [
    ['Apostles’ Creed', 'apostles'],
    ['Nicene Creed', 'nicene'],
    ['Westminster Shorter Catechism', 'wsc'],
  ] as const) {
    await page
      .locator('.document-cards')
      .getByRole('button')
      .filter({ has: page.locator('b', { hasText: label }) })
      .click();
    await expect(page.getByRole('button', { name: 'Whole document', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Browse', exact: true })).toHaveCount(0);
    await expect(page.locator('.document-range-inputs input')).toHaveCount(2);
    await shot(page, info, name);
  }
});

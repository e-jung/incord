import { test, expect, type Page, type Locator } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const tab = async (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
async function visibleResult(page: Page, result: Locator) {
  await expect(result).toBeVisible();
  await expect
    .poll(async () => {
      const box = await result.boundingBox(),
        bar = await page.locator('.tabbar').boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= (bar?.y ?? 852);
    })
    .toBe(true);
  await expect(page.locator('.page>.notice')).toHaveCount(0);
}
for (const width of [320, 393])
  test(`Discover progressive disclosure and local lookup feedback at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/');
    await tab(page, 'Discover');
    await expect(page.locator('.featured-cards .cover')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Topics', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel('Bible reference', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole('button', { name: 'Catechisms & creeds', exact: true }).click();
    await expect(page.getByLabel('Default translation', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add your own', exact: true }).click();
    const find = page.getByRole('button', { name: 'Find verses', exact: true });
    await expect(find).toBeDisabled();
    await page.getByLabel('Bible reference', { exact: true }).fill('not a reference');
    await find.click();
    await visibleResult(page, page.locator('.action-feedback[role=alert]'));
    await expect(page.locator('.action-feedback[role=alert]')).toContainText(/reference|book/i);
    const field = page.getByLabel('Bible reference', { exact: true });
    await field.fill('Romans 8:28');
    await find.click();
    await expect(page.locator('.passage-actions')).toBeVisible();
    await page
      .locator('.passage-actions > p[aria-live]')
      .evaluate((node) => node.setAttribute('data-stable-feedback', 'true'));
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    const added = page.locator('.passage-actions [role=status]');
    await visibleResult(page, added);
    await expect(added).toHaveAttribute('data-stable-feedback', 'true');
    await expect(added).toContainText(/added/i);
    await expect(added).toHaveCount(0, { timeout: 4500 });
    await tab(page, 'Library');
    await page.getByRole('button', { name: '+ Add', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add your own', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
test('Settings results stay with sound, preference, reminders and export controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: class {
        static permission = 'default';
      },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await page.getByRole('button', { name: 'Test sound', exact: true }).click();
  await visibleResult(page, page.locator('.feedback-setting [role=status]'));
  await expect(page.locator('.feedback-setting [role=status]')).toHaveCount(0, { timeout: 4500 });
  const name = page.getByLabel('Display name', { exact: true });
  await name.fill('Local reader');
  await name.blur();
  const saved = page.locator('.action-feedback').filter({ hasText: 'Saved on this device.' });
  await visibleResult(page, saved);
  await expect(saved).toHaveCount(0, { timeout: 4500 });
  await page.getByRole('button', { name: 'Enable reminders', exact: true }).click();
  await visibleResult(page, page.locator('.action-feedback[role=alert]'));
  await expect(page.locator('.action-feedback[role=alert]')).toContainText('Sign in');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export your data', exact: true }).click();
  await download;
  const exported = page.locator('.action-feedback').filter({ hasText: 'Your export is ready.' });
  await visibleResult(page, exported);
  await expect(exported).toHaveCount(0, { timeout: 4500 });
});

test('large batch confirms once and keeps its local receipt readable before dismissing', async ({
  page,
}) => {
  await page.goto('/');
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Add your own', exact: true }).click();
  await page.getByLabel('Bible reference', { exact: true }).fill('Psalm 119:1-24');
  await page.getByRole('button', { name: 'Find verses', exact: true }).click();
  await page.getByRole('button', { name: 'Separate verses', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const confirm = sheet.getByRole('button', { name: 'Add items', exact: true });
  await confirm.click();
  const receipt = sheet.getByRole('status');
  await expect(receipt).toHaveText('24 items added to your library.');
  await expect(receipt).toBeInViewport({ ratio: 1 });
  await expect(
    sheet.getByRole('button', { name: 'Added to your library.', exact: true }),
  ).toBeDisabled();
  await expect(sheet).toHaveCount(0, { timeout: 4500 });
  await expect(page.locator('.page>.notice')).toHaveCount(0);
});

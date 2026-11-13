import { test, expect } from '@playwright/test';

test('starter previews, collection additions, remove confirmation, Undo and re-add persistence', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation');
  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.cover').filter({ has: page.locator('b', { hasText: 'Psalm 23' }) }).click();
  await expect(page.getByRole('dialog', { name: 'Psalm 23', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add to my library', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Psalm 23', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add items', exact: true }).click();
  await page.getByRole('button', { name: 'Verses', exact: true }).click();
  await page.getByLabel('Bible reference').fill('John 11:35');
  await page.getByRole('button', { name: 'Find verses', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Psalm 23.*0 of 7 learned/ }).click();
  const options = page.getByRole('button', { name: 'Options for John 11:35', exact: true });
  const cover = await page.locator('.cover.compact').boundingBox();
  expect(cover!.height).toBe(120);
  await expect(page.locator('h1')).toHaveCount(1);
  const row = options.locator('..');
  const mainBox = await row.locator('.row-main').boundingBox();
  const optionsBox = await options.boundingBox();
  expect(optionsBox!.height).toBeGreaterThanOrEqual(44);
  expect(optionsBox!.width).toBeGreaterThanOrEqual(44);
  expect(optionsBox!.x).toBeGreaterThanOrEqual(mainBox!.x + mainBox!.width);
  expect(optionsBox!.y).toBeGreaterThanOrEqual(mainBox!.y);
  expect(optionsBox!.y + optionsBox!.height).toBeLessThanOrEqual(mainBox!.y + mainBox!.height);
  const primaryBox = await page.getByRole('button', { name: 'Start practice', exact: true }).boundingBox();
  expect(primaryBox!.width).toBe(cover!.width);

  await options.click();
  await page.getByRole('button', { name: 'Keep item', exact: true }).click();
  await expect(options).toBeVisible();
  await options.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(options).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(options).toBeVisible();
  await options.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Add items', exact: true }).click();
  await page.getByLabel('Bible reference').fill('John 11:35');
  await page.getByRole('button', { name: 'Find verses', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await nav.getByRole('button', { name: 'Today', exact: true }).click();
  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Psalm 23.*0 of 7 learned/ }).click();
  await page.getByRole('button').filter({ has: page.locator('b', { hasText: 'John 11:35' }) }).click();
  for (const word of await page.locator('[data-word]').allTextContents()) {
    await page.keyboard.press(word.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1).toLowerCase());
  }
  await expect(page.getByRole('dialog', { name: 'Step 1 passed' })).toBeVisible();
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await page.reload();
  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Psalm 23.*0 of 7 learned/ }).click();
  await expect(page.getByRole('button').filter({ has: page.locator('b', { hasText: 'John 11:35' }) })).toContainText('Step 2');
  const copies = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const state: any = await new Promise((resolve, reject) => { const r = db.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    return state.items.filter((i: any) => i.title === 'John 11:35');
  });
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatchObject({ step: 2, deleted: false });
});

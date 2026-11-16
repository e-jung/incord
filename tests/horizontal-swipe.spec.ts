import { test, expect, type Locator } from '@playwright/test';
// This file runs in the two Chromium projects, whose CDP supplies native touch
// scrolling. The shared full-bleed/gesture suites cover layout and rejection in WebKit.
test.use({ serviceWorkers: 'block' });
async function tap(button: Locator) {
  const overlay = button.locator(
    'xpath=following-sibling::input[contains(@class,"haptic-overlay")][1]',
  );
  if (await overlay.count()) await overlay.tap();
  else await button.tap();
}
test('horizontal swipes scroll Start here and category chips without activating either', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('incord.stats.enabled', '0');
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone OS 27_2', configurable: true });
  });
  await page.goto('/');
  await tap(page.getByRole('button', { name: 'Account settings', exact: true }));
  await page.getByLabel('Haptics', { exact: true }).check();
  await tap(page.getByRole('navigation').getByRole('button', { name: 'Discover', exact: true }));
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const selector of ['.featured-cards', '.discover-filters']) {
      const row = page.locator(selector);
      await row.scrollIntoViewIfNeeded();
      await row.evaluate((element) => element.scrollTo({ left: 0 }));
      const target =
        selector === '.featured-cards'
          ? row.locator('.cover').first()
          : row.getByRole('button', { name: 'Passages', exact: true });
      const overlay = target.locator(
        'xpath=following-sibling::input[contains(@class,"haptic-overlay")][1]',
      );
      await expect(overlay).toBeVisible();
      const box = (await overlay.boundingBox())!;
      await target.evaluate((button) => {
        button.dataset.swipeClicks = '0';
        button.addEventListener(
          'click',
          () => (button.dataset.swipeClicks = String(Number(button.dataset.swipeClicks) + 1)),
        );
      });
      const x = box.x + box.width * 0.8,
        y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let n = 1; n <= 8; n++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: Math.max(2, x - n * 15), y }],
        });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => row.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(target).toHaveAttribute('data-swipe-clicks', '0');
      // iOS switches can still issue a late click after native panning; never forward it.
      await overlay.evaluate((input) => (input as HTMLInputElement).click());
      await page.waitForTimeout(50);
      await expect(target).toHaveAttribute('data-swipe-clicks', '0');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(row.locator('button[aria-pressed=true]')).toHaveCount(
        selector === '.discover-filters' ? 1 : 0,
      );
    }
  } finally {
    await cdp.detach();
  }
});

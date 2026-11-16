import { test, expect, type Locator } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
async function tap(button: Locator) {
  const overlay = button.locator(
    'xpath=following-sibling::input[contains(@class,"haptic-overlay")][1]',
  );
  if (await overlay.count()) await overlay.tap();
  else await button.tap();
}
for (const width of [320, 393, 430])
  for (const scheme of ['light', 'dark'] as const)
    test(`Discover full-bleed scrollers retain content alignment at ${width}px ${scheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => {
        localStorage.setItem('incord.stats.enabled', '0');
        Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'userAgent', {
          value: 'iPhone OS 27_2',
          configurable: true,
        });
      });
      await page.goto('/');
      await tap(page.getByRole('button', { name: 'Account settings', exact: true }));
      await page.getByLabel('Haptics', { exact: true }).check();
      await tap(
        page.getByRole('navigation').getByRole('button', { name: 'Discover', exact: true }),
      );
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toBeVisible();
      for (const selector of ['.featured-cards', '.discover-filters']) {
        const row = page.locator(selector);
        const geometry = await row.evaluate((element) => {
          const box = element.getBoundingClientRect(),
            style = getComputedStyle(element);
          return {
            left: box.left,
            right: box.right,
            first: element.firstElementChild!.getBoundingClientRect().left,
            padding: style.paddingInlineStart,
            scrollPadding: style.scrollPaddingInlineStart,
            snap: style.scrollSnapType,
            scrollbar: style.scrollbarWidth,
          };
        });
        expect(geometry.left).toBeCloseTo(0);
        expect(geometry.right).toBeCloseTo(width);
        expect(geometry.first).toBeCloseTo(24);
        expect(geometry.snap).toMatch(/^x(?: proximity)?$/);
        expect(geometry).toMatchObject({
          padding: '24px',
          scrollPadding: '24px',
          scrollbar: 'none',
        });
        await expect(row.locator('input.haptic-overlay').first()).toHaveCSS(
          'touch-action',
          'pan-x pan-y',
        );
        await row.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
        await expect.poll(() => row.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

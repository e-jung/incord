import { test as base, expect, type Response } from '@playwright/test';
import { installAccountsBrowser } from './accounts-browser';
export * from '@playwright/test';
export const test = base.extend<{ accountsBrowser: void }>({
  accountsBrowser: [
    async ({ browser, context, baseURL }, use) => {
      if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
        await use();
        return;
      }
      const cookieHeaders: Promise<string>[] = [];
      const collect = (response: Response) => {
        if (/\/(?:api\/auth\/|auth\/jesklabs\/callback)/.test(new URL(response.url()).pathname))
          cookieHeaders.push(response.allHeaders().then((headers) => headers['set-cookie'] || ''));
      };
      context.on('response', collect);
      await installAccountsBrowser(context, baseURL);
      const original = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const next = await original(options);
        await installAccountsBrowser(next, baseURL);
        return next;
      };
      try {
        await use();
      } finally {
        browser.newContext = original;
        context.off('response', collect);
        for (const header of await Promise.all(cookieHeaders))
          expect(header).not.toMatch(/Domain=/i);
      }
    },
    { auto: true },
  ],
});

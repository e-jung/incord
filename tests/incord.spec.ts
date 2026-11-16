import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import worker, { RegistryDO, UserDO, StatsDO, type Env } from '../cloudflare/worker';

const origin = 'https://incord.jesklabs.com';
const statsToken = 'fix7-browser-local-stats-token-32-characters';
function state(id = 'migration-fixture') {
  const db = new DatabaseSync(':memory:');
  const kv = new Map<string, unknown>();
  const storage: any = {
    get: async (key: string) => kv.get(key),
    put: async (key: string, value: unknown) => {
      kv.set(key, value);
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) kv.delete(key);
    },
    list: async (options: { prefix?: string } = {}) =>
      new Map([...kv].filter(([key]) => key.startsWith(options.prefix || ''))),
    setAlarm: async () => {},
    transaction: async (fn: (tx: any) => unknown) => fn(storage),
  };
  return {
    id: { toString: () => id },
    storage: {
      ...storage,
      sql: {
        exec(query: string, ...args: any[]) {
          const s = db.prepare(query);
          return s.columns().length ? s.all(...args) : (s.run(...args), []);
        },
      },
      transactionSync: (fn: () => unknown) => fn(),
    },
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
  } as unknown as DurableObjectState;
}
async function workerFixture(page: Page) {
  const env = {
    SESSION_SECRET: 'fix7-browser-local-session-secret-32-characters',
    STATS_TOKEN: statsToken,
  } as Env;
  const registry = new RegistryDO(state()),
    stats = new StatsDO(state()),
    users = new Map<string, UserDO>();
  const namespace = (resolve: (id: string) => { fetch: (request: Request) => Promise<Response> }) =>
    ({
      idFromName: (id: string) => id,
      get: (id: string) => ({
        fetch: (url: string, init: RequestInit) => resolve(id).fetch(new Request(url, init)),
      }),
    }) as unknown as DurableObjectNamespace;
  env.REGISTRY = namespace(() => registry);
  env.STATS = namespace(() => stats);
  env.USERS = namespace((id) => {
    if (!users.has(id)) users.set(id, new UserDO(state(id), env));
    return users.get(id)!;
  });
  env.ASSETS = {
    fetch: async () =>
      new Response(
        '<!doctype html><title>Secure origin fixture</title><h1>Secure origin fixture</h1>',
        { headers: { 'Content-Type': 'text/html' } },
      ),
  } as Fetcher;
  await page.route(origin + '/**', async (route) => {
    const r = route.request();
    const response = await worker.fetch(
      new Request(r.url(), {
        method: r.method(),
        headers: await r.allHeaders(),
        ...(!['GET', 'HEAD'].includes(r.method()) && r.postData() ? { body: r.postData()! } : {}),
      }),
      env,
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  return env;
}
async function api(page: Page, path: string, input: unknown) {
  return page.evaluate(
    async ({ path, input }) => {
      const r = await fetch('/api' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return { status: r.status, data: await r.json() };
    },
    { path, input },
  );
}
test.describe('Secure-origin worker integration', () => {
  test.use({ serviceWorkers: 'block' });
  test('removed auth endpoints are unavailable on the canonical HTTPS origin', async ({ page }) => {
    await workerFixture(page);
    await page.goto(origin);
    for (const path of [
      '/auth/register/options',
      '/auth/register/verify',
      '/auth/login/options',
      '/auth/login/verify',
      '/auth/recover',
    ])
      expect((await api(page, path, { legacy: true })).status).toBe(404);
    const config = await page.evaluate(async () => await (await fetch('/api/config')).json());
    expect(config).not.toHaveProperty('passkeys');
    expect(config.googleEnabled).toBe(false);
  });
  test('private counts HTML form submits from its protected same-origin page', async ({ page }) => {
    await page.goto('/stats');
    await page.getByLabel('Stats token').fill('incord-playwright-local-stats-token-32chars');
    await page.getByRole('button', { name: 'View counts' }).click();
    await expect(page.getByRole('heading', { name: 'Incord · Private counts' })).toBeVisible();
  });
  test('private counts requires token, uses a scoped HttpOnly cookie and renders aggregate dashboard', async ({
    page,
  }, info) => {
    const env = await workerFixture(page);
    await page.goto(origin + '/stats');
    await expect(page.getByRole('heading', { name: 'Private counts', exact: true })).toBeVisible();
    const login = (token: string) =>
      worker.fetch(
        new Request(origin + '/stats', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        }),
        env,
      );
    expect((await login('wrong')).status).toBe(401);
    const authenticated = await login(statsToken);
    expect(authenticated.status).toBe(303);
    const value = authenticated.headers
      .get('set-cookie')!
      .split(';')[0]
      .slice('incord_stats='.length);
    await page
      .context()
      .addCookies([
        {
          name: 'incord_stats',
          value,
          domain: 'incord.jesklabs.com',
          path: '/stats',
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      ]);
    await page.goto(origin + '/stats');
    await expect(page.getByRole('heading', { name: 'Incord · Private counts' })).toBeVisible();
    const cookie = (await page.context().cookies()).find((c) => c.name === 'incord_stats')!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/stats',
    });
    expect(page.url()).not.toContain(statsToken);
    await shot(page, info.project.name, 'stats');
    const logout = await worker.fetch(
      new Request(origin + '/stats/logout', { method: 'POST', headers: { Origin: origin } }),
      env,
    );
    expect(logout.status).toBe(303);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    await page.context().clearCookies();
    await page.goto(origin + '/stats');
    await expect(page.getByLabel('Stats token')).toBeVisible();
  });
});
async function shot(page: Page, project: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir('test-results/screens/qa7', { recursive: true });
  await page.screenshot({ path: `test-results/screens/qa7/${project}-${name}.png` });
}
const tab = async (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
test.describe('FIX-7 UI migration evidence', () => {
  test.use({ serviceWorkers: 'block' });
  test('About, privacy opt-out, new icon, Discover ESV and practice attribution', async ({
    page,
  }, info) => {
    await page.route('**/api/esv?*', (route) =>
      route.fulfill({
        contentType: 'text/plain',
        body: 'The LORD is my shepherd; I shall not want.',
      }),
    );
    await page.route('**/api/config', (route) =>
      route.fulfill({ json: { email: true, googleEnabled: false } }),
    );
    await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
    await page.route('**/api/stats', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Account settings', exact: true }).click();
    const about = page.getByRole('region', { name: 'About', exact: true });
    await expect(about).toContainText('Incord');
    await expect(about).toContainText('Crossway');
    await about.scrollIntoViewIfNeeded();
    await shot(page, info.project.name, 'about');
    const privacy = page.getByRole('checkbox', { name: 'Share anonymous usage counts' });
    await privacy.scrollIntoViewIfNeeded();
    await privacy.uncheck();
    await expect(privacy).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('incord.stats.enabled'))).toBe('0');
    await shot(page, info.project.name, 'privacy');
    await tab(page, 'Discover');
    await page.getByRole('button', { name: 'Add your own', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Default translation', exact: true })
      .selectOption('ESV');
    await page.getByLabel('Bible reference', { exact: true }).fill('Psalm 23:1');
    await page.getByRole('button', { name: 'Find verses', exact: true }).click();
    await expect(
      page.getByText('The LORD is my shepherd; I shall not want.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.esv-attribution').first().getByRole('link', { name: 'ESV', exact: true }),
    ).toHaveAttribute('href', 'https://www.esv.org');
    await shot(page, info.project.name, 'discover-esv');
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    await tab(page, 'Library');
    await page.getByRole('button', { name: /^My verses 0 of 1 learned/ }).click();
    await page
      .getByRole('button')
      .filter({ has: page.locator('b', { hasText: 'Psalm 23:1' }) })
      .click();
    await expect(
      page.locator('.practice .esv-attribution').getByRole('link', { name: 'ESV', exact: true }),
    ).toHaveAttribute('href', 'https://www.esv.org');
    await shot(page, info.project.name, 'practice-attribution');
    await page.goto('/icon.svg');
    await expect(page.locator('svg')).toBeVisible();
    await shot(page, info.project.name, 'new-icon');
  });
});

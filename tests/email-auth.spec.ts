import { testIp } from './network';
import { test, expect, type Page } from './accounts-playwright';

async function settings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
}
async function start(page: Page, email: string) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  return (
    await (await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email))).json()
  ).code as string;
}
async function verify(page: Page, code: string) {
  const origin = new URL(page.url()).origin;
  const returned = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === origin &&
      url.pathname === '/' &&
      url.searchParams.get('signedIn') === '1' &&
      response.request().isNavigationRequest()
    );
  });
  await page.getByLabel('Six-digit code').fill(code);
  await returned;
  await page.waitForURL(
    (url) => url.origin === origin && url.searchParams.get('signedIn') === '1',
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
}
async function signout(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
}
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': testIp() });
});

test('email signup is first in settings, six digits auto-submit, returning email preserves account', async ({
  page,
}) => {
  await settings(page);
  await expect(page.locator('.settings-group').first()).toHaveAttribute(
    'aria-labelledby',
    'account-heading',
  );
  const email = `signup-${crypto.randomUUID()}@example.com`,
    code = await start(page, email);
  await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
  await page.getByLabel('Six-digit code').fill(code.slice(0, 5));
  await expect(page.getByRole('button', { name: 'Verify code', exact: true })).toBeDisabled();
  await verify(page, code);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  const first = (await (await page.request.get('/api/me')).json()).user;
  expect(first.hasEmail).toBe(true);
  await expect(page.getByRole('button', { name: 'Add email sign-in', exact: true })).toHaveCount(0);
  await signout(page);
  await start(page, email);
  const next = (
    await (await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email))).json()
  ).code;
  await verify(page, next);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/me')).json()).user.id).toBe(first.id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('busy controls, inline delivery and invalid-code errors, resend cooldown and change email', async ({
  page,
}) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { email: true, google: true, googleEnabled: true } }),
  );
  await settings(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/auth/email/start', async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'Email delivery unavailable. Try again.' } });
  });
  await page.getByLabel('Email address', { exact: true }).fill('error@example.com');
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sending code…', exact: true })).toBeDisabled();
  release();
  await expect(
    page.getByRole('form', { name: 'Sign in with email' }).getByRole('alert'),
  ).toContainText('Email delivery unavailable');
  await expect(page.getByRole('form').getByRole('alert')).toBeInViewport({ ratio: 1 });
  expect(
    await page
      .getByRole('form')
      .getByRole('alert')
      .evaluate((el) => el.previousElementSibling?.textContent),
  ).toBe('Email me a code');
  await page.unroute('**/api/auth/email/start');
  await page.clock.install();
  const email = `retry-${crypto.randomUUID()}@example.com`;
  const code = await start(page, email);
  await page.getByLabel('Six-digit code').fill(code === '000000' ? '111111' : '000000');
  await expect(page.getByRole('form').getByRole('alert')).toContainText('invalid');
  await expect(page.getByRole('form').getByRole('alert')).toBeInViewport({ ratio: 1 });
  expect(
    await page
      .getByRole('form')
      .getByRole('alert')
      .evaluate((el) => el.previousElementSibling?.textContent),
  ).toBe('Verify code');
  await page.clock.fastForward(31000);
  await expect(page.getByRole('button', { name: 'Resend code', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Use a different email', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Six-digit code')).toHaveCount(0);
});

test('feature toggle hides email while Google sign-in remains available', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { email: false, googleEnabled: true } }),
  );
  await settings(page);
  await expect(
    page.getByRole('button', { name: 'Continue with Google', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Sign in with email' })).toHaveCount(0);
});

test('a second independent browser context signs into the same email account', async ({
  page,
  browser,
  baseURL,
}) => {
  await settings(page);
  const email = `second-device-${crypto.randomUUID()}@example.com`,
    code = await start(page, email);
  await verify(page, code);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  const first = (await (await page.request.get('/api/me')).json()).user;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 393, height: 852 },
    extraHTTPHeaders: { 'CF-Connecting-IP': testIp() },
  });
  try {
    const other = await context.newPage();
    await settings(other);
    const code = await start(other, email);
    await verify(other, code);
    await expect(other.getByText('Signed in.', { exact: true })).toBeVisible();
    expect((await (await other.request.get('/api/me')).json()).user.id).toBe(first.id);
    expect((await (await page.request.get('/api/me')).json()).user.id).toBe(first.id);
    await expect(other.getByRole('dialog')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

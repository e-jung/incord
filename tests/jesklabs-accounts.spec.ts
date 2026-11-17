import { testIp } from './network';
import { accountsScenario } from './accounts-browser';
import { test, expect, type Page, type APIResponse } from './accounts-playwright';
import { createHash, createHmac, randomBytes } from 'node:crypto';
const sheet = (page: Page) =>
  page.getByRole('dialog', { name: 'Continue with Jesklabs?', exact: true });
async function checked(response: APIResponse) {
  expect(response.ok(), `HTTP ${response.status()}`).toBe(true);
  return response.json();
}
async function me(page: Page) {
  return (await checked(await page.request.get('/api/me'))).user;
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
}
async function open(page: Page) {
  await page.goto('/');
  await settings(page);
}
async function emailSignin(page: Page, email: string) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const { code } = await checked(
    await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email)),
  );
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('Six-digit code').fill(code);
}
async function signedIn(page: Page) {
  await expect.poll(async () => !!(await me(page))).toBe(true);
}
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': testIp() });
});

test('email RPC sign-in performs a top-level single-use SSO attach and retains its local session', async ({
  page,
}) => {
  await open(page);
  const hop = page.waitForRequest('https://accounts.jesklabs.com/sso/attach?**');
  await emailSignin(page, `attach-${crypto.randomUUID()}@example.com`);
  const request = await hop;
  expect(request.isNavigationRequest()).toBe(true);
  expect(new URL(request.url()).searchParams.get('client')).toBe('incord');
  await signedIn(page);
  await expect(page).toHaveURL(/signedIn=1/);
  expect(
    (
      await page.request.get('/__test/accounts/sso/attach' + new URL(request.url()).search)
    ).status(),
  ).toBe(400);
  const first = await me(page);
  await settings(page);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  expect(await me(page)).toMatchObject({ id: first.id, hasEmail: true });
});

test('prompt none requires masked in-app confirmation before creating the session', async ({
  page,
  context,
}) => {
  accountsScenario(context, { email: 'silent-person@example.com', sso: 'present' });
  let hops = 0;
  page.on('request', (r) => {
    if (r.url().startsWith('https://accounts.jesklabs.com/authorize')) hops++;
  });
  await open(page);
  expect(hops).toBe(0);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('Continue as s•••@example.com');
  expect(await me(page)).toBeNull();
  await sheet(page).getByRole('button', { name: 'Continue', exact: true }).click();
  await signedIn(page);
  await expect(sheet(page)).toHaveCount(0);
  expect(hops).toBe(1);
});

test('Use a different account cancels pending SSO and keeps normal options signed out', async ({
  page,
  context,
}) => {
  accountsScenario(context, { email: 'cancel-person@example.com', sso: 'present' });
  await open(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Use a different account', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(await me(page)).toBeNull();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeFocused();
  expect(await me(page)).toBeNull();
});

test('login_required opens normal options and the second tap does not repeat the SSO hop', async ({
  page,
  context,
}) => {
  accountsScenario(context, { sso: 'none' });
  await open(page);
  let hops = 0;
  page.on('request', (r) => {
    if (r.url().startsWith('https://accounts.jesklabs.com/authorize')) hops++;
  });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/jlOptions=1/);
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeFocused();
  expect(hops).toBe(1);
  expect(await me(page)).toBeNull();
});

test('Google button uses accounts authorize with real state and S256 PKCE', async ({
  page,
  context,
}) => {
  accountsScenario(context, { email: `google-${crypto.randomUUID()}@example.com` });
  await open(page);
  const hop = page.waitForRequest('https://accounts.jesklabs.com/authorize?**');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const url = new URL((await hop).url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
  expect(url.searchParams.has('return')).toBe(false);
  await signedIn(page);
  expect(await me(page)).toMatchObject({ hasGoogle: true });
});

test('pre-cutover session format and app-local sign-in codes remain valid', async ({
  page,
  context,
  baseURL,
}) => {
  await open(page);
  const created = await checked(
    await page.request.post('/api/auth/code/create', { headers: { Origin: baseURL! }, data: {} }),
  );
  const existing = (await context.cookies()).find((c) => c.name === 'bh_session')!;
  const payload = JSON.parse(Buffer.from(existing.value.split('.')[0], 'base64url').toString());
  const value = Buffer.from(
    JSON.stringify({
      uid: payload.uid,
      version: payload.version,
      exp: Math.floor(Date.now() / 1000) + 86400,
    }),
  ).toString('base64url');
  const cookie =
    value +
    '.' +
    createHmac('sha256', 'byheart-playwright-local-only-secret-32chars')
      .update(value)
      .digest('base64url');
  await context.addCookies([
    { name: 'bh_session', value: cookie, url: baseURL!, httpOnly: true, sameSite: 'Lax' },
  ]);
  expect(await me(page)).toMatchObject({ id: created.user.id, hasCode: true });
  await context.clearCookies();
  expect(await me(page)).toBeNull();
  const restored = await checked(
    await page.request.post('/api/auth/code/signin', {
      headers: { Origin: baseURL! },
      data: { code: created.code },
    }),
  );
  expect(restored.user.id).toBe(created.user.id);
});

test('email SSO attach preserves a Groups invite deep link', async ({ page, baseURL }) => {
  const owner = await page
    .context()
    .browser()!
    .newContext({ baseURL, extraHTTPHeaders: { 'CF-Connecting-IP': testIp() } });
  try {
    await checked(
      await owner.request.post('/api/auth/code/create', {
        headers: { Origin: baseURL! },
        data: {},
      }),
    );
    const name = 'SSO group ' + crypto.randomUUID().slice(0, 8);
    const created = await checked(
      await owner.request.post('/api/groups', { headers: { Origin: baseURL! }, data: { name } }),
    );
    await page.goto(created.invite.url);
    await settings(page);
    await emailSignin(page, `invite-${crypto.randomUUID()}@example.com`);
    await signedIn(page);
    const introduction = page.getByRole('form', { name: 'Introduce yourself', exact: true });
    await expect(introduction).toBeVisible();
    await introduction.getByLabel('Your name in groups', { exact: true }).fill('Email Member');
    await introduction.getByRole('button', { name: 'Save name and continue', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Groups', exact: true })
        .getByRole('article', { name, exact: true }),
    ).toBeVisible();
  } finally {
    await owner.close();
  }
});

test('silent SSO confirmation preserves real MCP OAuth consent continuation', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  accountsScenario(context, {
    email: `mcp-sso-${crypto.randomUUID()}@example.com`,
    sso: 'present',
  });
  const callback = 'http://localhost:19876/callback',
    clientName = 'SSO MCP ' + crypto.randomUUID();
  const client = await checked(
    await page.request.post('/oauth/register', {
      data: {
        client_name: clientName,
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      },
    }),
  );
  const verifier = randomBytes(32).toString('base64url'),
    state = crypto.randomUUID(),
    resource = new URL('/mcp', baseURL).href;
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'library:read',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    resource,
  });
  await page.goto('/oauth/authorize?' + params);
  await expect(
    page.getByRole('heading', { name: 'Sign in to connect an app', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  const consentLoaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/oauth/consent' && r.status() === 200,
  );
  await sheet(page).getByRole('button', { name: 'Continue', exact: true }).click();
  const response = await consentLoaded;
  if (browserName === 'webkit') {
    const binding = (await response.headerValue('set-cookie'))?.split(';')[0];
    expect(binding).toContain('__Host-oauth-consent-');
    await page.route('**/api/oauth/consent', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const cookies = await context.cookies(route.request().url());
      const cookie = [...cookies.map((c) => c.name + '=' + c.value), binding].join('; ');
      await route.fulfill({
        response: await route.fetch({ headers: { ...route.request().headers(), cookie } }),
      });
    });
  }
  await expect(page.getByRole('heading', { name: clientName, exact: true })).toBeVisible();
  await page.route(callback + '**', (route) =>
    route.fulfill({ body: '<title>MCP callback</title>', contentType: 'text/html' }),
  );
  const returned = page.waitForRequest(callback + '**');
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
  const url = new URL((await returned).url());
  expect(url.searchParams.get('state')).toBe(state);
  const tokens = await checked(
    await page.request.post('/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: callback,
        code: url.searchParams.get('code')!,
        code_verifier: verifier,
        resource,
      },
    }),
  );
  expect(tokens.access_token).toEqual(expect.any(String));
});

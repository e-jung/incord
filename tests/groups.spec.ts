import { testIp } from './network';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  test,
  expect,
  type Page,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Response,
} from './accounts-playwright';

const groups = (page: Page) => page.getByRole('region', { name: 'Groups', exact: true });
const groupArticle = (page: Page, name: string) =>
  groups(page).getByRole('article', { name, exact: true });
const headers = (base: string) => ({ Origin: new URL(base).origin });
async function checked(response: APIResponse) {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const navigation = (page: Page) =>
  page.getByRole('navigation', { name: 'Main navigation', exact: true });
async function tap(button: Locator) {
  await button.waitFor({ state: 'visible' });
  await button
    .page()
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const overlay = button.locator(
    'xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]',
  );
  if (await overlay.count()) await overlay.tap();
  else await button.click();
}
async function tab(page: Page, name: string) {
  const button = navigation(page).getByRole('button', { name, exact: true });
  await tap(button);
  await expect(button).toHaveAttribute('aria-current', 'page');
  if (name === 'Today') await expect(groups(page)).toHaveCount(0);
}
// Signed-in entry always fetches the list and, when present, its selected detail.
async function openGroups(page: Page) {
  if (
    (await navigation(page)
      .getByRole('button', { name: 'Groups', exact: true })
      .getAttribute('aria-current')) === 'page'
  )
    await tab(page, 'Today');
  const details: Response[] = [];
  const observe = (response: Response) => {
    if (
      response.request().method() === 'GET' &&
      /^\/api\/groups\/[^/]+$/.test(new URL(response.url()).pathname)
    )
      details.push(response);
  };
  page.on('response', observe);
  try {
    const listed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/groups' && r.request().method() === 'GET',
    );
    await tab(page, 'Groups');
    const response = await listed;
    expect(response.ok()).toBe(true);
    const result = await response.json();
    await response.finished();
    await expect(groups(page).getByText('Loading your groups…', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Groups', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(groups(page)).toBeVisible();
    if (result.groups.length) {
      await expect.poll(() => details.length).toBeGreaterThan(0);
      for (const detail of details) {
        expect(detail.ok()).toBe(true);
        await detail.finished();
      }
      await expect(groups(page).getByRole('article')).toHaveCount(1);
      await expect(groups(page).getByRole('article')).toHaveAttribute('aria-busy', 'false');
    }
  } finally {
    page.off('response', observe);
  }
}
async function form(page: Page, kind: 'create' | 'join') {
  const field = groups(page).getByLabel(kind === 'create' ? 'Group name' : 'Invite code', {
    exact: true,
  });
  const emptyAction = groups(page).getByRole('button', {
    name: kind === 'create' ? 'Create a group' : 'Join with a code',
    exact: true,
  });
  const summary = groups(page).getByText('Create or join a group', { exact: true });
  await expect
    .poll(
      async () =>
        (await field.isVisible()) || (await emptyAction.isVisible()) || (await summary.isVisible()),
    )
    .toBe(true);
  if (!(await field.isVisible())) {
    if (await emptyAction.isVisible()) await tap(emptyAction);
    else await summary.click();
  }
  await expect(field).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
}
async function verifyEmail(page: Page, code: string) {
  const current = new URL(page.url()),
    invited = current.pathname.startsWith('/join/');
  // The attach handoff navigates through Accounts before returning to a fresh app.
  // Invite return paths use the normalized code; autojoin may replace that URL with /.
  const returnPath = invited
    ? '/join/' + current.pathname.slice('/join/'.length).replace(/-/g, '').toLowerCase()
    : '/';
  const returned = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === current.origin &&
      url.pathname === returnPath &&
      (invited || url.searchParams.get('signedIn') === '1') &&
      response.request().isNavigationRequest()
    );
  });
  await page.getByLabel('Six-digit code').fill(code);
  await returned;
  await page.waitForURL(
    (url) =>
      url.origin === current.origin &&
      (invited
        ? url.pathname === returnPath || url.pathname === '/'
        : url.pathname === '/' && url.searchParams.get('signedIn') === '1'),
    { waitUntil: 'domcontentloaded' },
  );
  if (invited)
    await expect(
      groups(page).getByRole('form', { name: 'Introduce yourself', exact: true }),
    ).toBeVisible();
  await settings(page);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
}
async function login(page: Page, name: string) {
  const invited = new URL(
    page.url() === 'about:blank' ? 'http://localhost/' : page.url(),
  ).pathname.startsWith('/join/');
  if (!page.url() || page.url() === 'about:blank') await page.goto('/');
  await settings(page);
  const email = `groups-${crypto.randomUUID()}@example.com`;
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const code = (
    await (await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email))).json()
  ).code;
  await verifyEmail(page, code);
  if (name) {
    await page.getByLabel('Display name', { exact: true }).fill(name);
    await page.getByLabel('Display name', { exact: true }).press('Tab');
  }
  await expect
    .poll(async () => (await (await page.request.get('/api/export')).json()).settings.name)
    .toBe(name);
  if (invited) await openGroups(page);
  return email;
}
async function create(page: Page, name: string, approval = false) {
  await openGroups(page);
  await form(page, 'create');
  await groups(page).getByLabel('Group name', { exact: true }).fill(name);
  if (approval) await groups(page).getByLabel('Approve new members', { exact: true }).check();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/groups' && r.request().method() === 'POST',
  );
  await groups(page).getByRole('button', { name: 'Create group', exact: true }).click();
  const result = await checked(await response);
  await expect(groupArticle(page, name)).toBeVisible();
  return result;
}
async function invite(page: Page, name: string) {
  const article = groupArticle(page, name);
  await article.getByText('Manage group', { exact: true }).click();
  // Creation already returns an invite; generate explicitly as well to cover rotation.
  const generated = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/invite') && r.request().method() === 'POST',
  );
  await article.getByRole('button', { name: 'Generate invite', exact: true }).click();
  const result = await checked(await generated);
  await expect(article.getByLabel('Invite code', { exact: true })).toHaveValue(result.code);
  await expect(article.getByLabel('Invite link', { exact: true })).toBeVisible();
  return {
    url: await article.getByLabel('Invite link', { exact: true }).inputValue(),
    code: await article.getByLabel('Invite code', { exact: true }).inputValue(),
  };
}
async function refresh(page: Page) {
  await openGroups(page);
}
async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 852 });
  const outside = await groups(page)
    .locator('button,input,select,textarea')
    .evaluateAll(
      (nodes, width) =>
        nodes
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && (rect.left < -0.5 || rect.right > Number(width) + 0.5);
          })
          .map((node) => node.outerHTML.slice(0, 160)),
      width,
    );
  expect(outside).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ context }) =>
  context.setExtraHTTPHeaders({ 'CF-Connecting-IP': testIp() }),
);

test('three isolated members: link/code invites, Discover goal sync, prayer, title privacy, leave and removal', async ({
  page,
  browser,
  baseURL,
}, info) => {
  // Multi-context real-Worker flows are slower in Linux WebKit on shared CI.
  // Keep every assertion/action deadline; allow the complete flow to finish.
  test.setTimeout(browser.browserType().name() === 'webkit' ? 300000 : 180000);
  const contexts: BrowserContext[] = [];
  let groupId = '';
  const make = async () => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 393, height: 852 },
      colorScheme: info.project.use.colorScheme as 'light' | 'dark',
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
      extraHTTPHeaders: { 'CF-Connecting-IP': testIp() },
    });
    contexts.push(context);
    return context.newPage();
  };
  const anna = await make(),
    ben = await make(),
    name = 'Small circle ' + crypto.randomUUID().slice(0, 8);
  try {
    await page.goto('/');
    await login(page, 'Eric');
    const created = await create(page, name);
    groupId = created.group.id;
    const link = await invite(page, name);
    expect(link.code).toMatch(
      /^[abcdefghjkmnpqrstuvwxyz23456789]{4}(?:-[abcdefghjkmnpqrstuvwxyz23456789]{4}){3}$/,
    );
    // Link is opened signed out, then survives a full reload before email sign-in.
    await anna.goto(link.url);
    await expect(
      anna.getByRole('heading', { name: 'Groups', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(groups(anna).getByText('Sign in to accept your group invite.')).toBeVisible();
    await anna.reload();
    await login(anna, 'Anna');
    await expect(groupArticle(anna, name)).toBeVisible();
    expect(new URL(anna.url()).pathname).toBe('/');
    await ben.goto('/');
    await login(ben, 'Ben');
    await openGroups(ben);
    await form(ben, 'join');
    await groups(ben).getByLabel('Invite code', { exact: true }).fill(link.code.toUpperCase());
    await groups(ben).getByRole('button', { name: 'Join group', exact: true }).click();
    await expect(groupArticle(ben, name)).toBeVisible();
    await refresh(page);
    await expect(groupArticle(page, name).getByText('3 members · You are the owner')).toBeVisible();
    await groupArticle(page, name)
      .getByRole('button', { name: 'Choose goal in Discover', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Choose a group goal', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Passages', exact: true }).click();
    await page
      .locator('.featured-cards')
      .getByRole('button', { name: /Psalm 23/ })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Use as group goal', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Groups', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      groupArticle(page, name).getByRole('region', { name: 'Group goal' }),
    ).toContainText('Psalm 23');
    // Keep interception installed until the follow-up sync and inline result settle.
    // Removing a one-shot Chromium route during that immediate fetch can strand it.
    const rejectedGoal = '**/api/groups/' + groupId + '/goal/add';
    await page.route(rejectedGoal, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ status: 'invalid reference', reason: 'ESV content limit reached' }],
        }),
      }),
    );
    await groupArticle(page, name)
      .getByRole('button', { name: 'Add goal to my library', exact: true })
      .click();
    await expect(groupArticle(page, name).getByRole('alert')).toContainText(
      '1 item was not added. ESV content limit reached',
    );
    await expect(
      groupArticle(page, name).getByText('Goal added to your library.', { exact: true }),
    ).toHaveCount(0);
    await page.unroute(rejectedGoal);
    await groupArticle(page, name)
      .getByRole('button', { name: 'Add goal to my library', exact: true })
      .click();
    await expect(
      groupArticle(page, name).getByText('Goal added to your library.', { exact: true }),
    ).toBeVisible();
    let exported = await (await page.request.get('/api/export')).json();
    const goalItem = exported.items.find((i: any) => i.origin === 'group');
    expect(goalItem.id).toBe('bsb-psa-23-1--bsb-psa-23-6');
    // A later device revision must survive another group add, and canonical IDs deduplicate.
    const revised = { ...goalItem, step: 3, updatedAt: goalItem.updatedAt + 10000 };
    await checked(
      await page.request.post('/api/sync', {
        headers: headers(baseURL!),
        data: { items: [revised], events: [], settings: { updatedAt: 0 } },
      }),
    );
    await groupArticle(page, name)
      .getByRole('button', { name: 'Add goal to my library', exact: true })
      .click();
    await expect(
      groupArticle(page, name).getByRole('button', { name: 'Add goal to my library', exact: true }),
    ).toBeEnabled();
    exported = await (await page.request.get('/api/export')).json();
    expect(exported.items.filter((i: any) => i.id === goalItem.id)).toHaveLength(1);
    expect(exported.items.find((i: any) => i.id === goalItem.id).step).toBe(3);
    await refresh(anna);
    await groupArticle(anna, name)
      .getByRole('button', { name: 'Add goal to my library', exact: true })
      .click();
    await expect(
      groupArticle(anna, name).getByText('Goal added to your library.', { exact: true }),
    ).toBeVisible();
    await tab(anna, 'Library');
    await anna.getByRole('button', { name: /^My verses/ }).click();
    await expect(anna.getByText(/Psalm 23:1.*6/).first()).toBeVisible();
    await openGroups(anna);
    // Seed a chosen title and private body. Only the title may be projected.
    const privateBody = 'THIS PRIVATE BODY MUST NEVER BE SHARED',
      privateId = 'own-' + crypto.randomUUID(),
      privateEvent = crypto.randomUUID();
    await checked(
      await page.request.post('/api/sync', {
        headers: headers(baseURL!),
        data: {
          items: [
            {
              id: privateId,
              title: 'My chosen memory title',
              text: privateBody,
              collection: 'personal',
              learned: true,
              step: 4,
              due: new Date().toISOString(),
              updatedAt: Date.now() + 20000,
            },
          ],
          events: [
            {
              id: privateEvent,
              itemId: privateId,
              at: new Date().toISOString(),
              grade: 'Good',
              slips: 7,
              hidden: 10,
            },
          ],
          settings: { updatedAt: 0 },
        },
      }),
    );
    await refresh(anna);
    let view = (await checked(await anna.request.get('/api/groups/' + groupId))).group;
    const eric = view.members.find((m: any) => m.name === 'Eric');
    expect(eric.titles.some((t: any) => t.title === 'My chosen memory title' && t.learned)).toBe(
      true,
    );
    expect(JSON.stringify(view)).not.toContain(privateBody);
    expect(JSON.stringify(view)).not.toContain(privateEvent);
    expect(eric.weekDays.length).toBe(1);
    await expect(
      groupArticle(anna, name)
        .locator('.member')
        .filter({ has: anna.getByText('Eric', { exact: true }) })
        .locator('.week-dots .done'),
    ).toHaveCount(1);
    expect(eric.id).not.toBe((await (await page.request.get('/api/me')).json()).user.id);
    await groupArticle(anna, name)
      .getByRole('button', { name: 'Pray for Eric', exact: true })
      .click();
    await expect(groupArticle(anna, name).getByText('Prayer sent.', { exact: true })).toBeVisible();
    await groupArticle(anna, name)
      .getByRole('button', { name: 'Pray for Eric', exact: true })
      .click();
    await expect(
      groupArticle(anna, name).getByText('You have already sent a prayer today.', { exact: true }),
    ).toBeVisible();
    await groupArticle(anna, name).getByLabel('Weekly group summary', { exact: true }).uncheck();
    await expect(
      groupArticle(anna, name).getByText('Weekly summary off.', { exact: true }),
    ).toBeVisible();
    await settings(page);
    await page
      .getByRole('checkbox', { name: "Show what I'm memorizing to my groups", exact: true })
      .uncheck();
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/export')).json()).settings.groupShareTitles,
      )
      .toBe(false);
    view = (await checked(await anna.request.get('/api/groups/' + groupId))).group;
    expect(view.members.find((m: any) => m.name === 'Eric')).not.toHaveProperty('titles');
    await refresh(anna);
    const ericRow = groupArticle(anna, name)
      .locator('.member')
      .filter({ has: anna.getByText('Eric', { exact: true }) });
    await expect(ericRow.getByText('Item titles', { exact: true })).toHaveCount(0);
    await page.reload();
    await settings(page);
    await expect(
      page.getByRole('checkbox', { name: "Show what I'm memorizing to my groups", exact: true }),
    ).not.toBeChecked();
    await openGroups(page);
    for (const width of [320, 393]) {
      await fits(page, width);
      await fits(anna, width);
    }
    await groupArticle(ben, name).getByRole('button', { name: 'Leave group', exact: true }).click();
    await expect(ben.getByRole('dialog', { name: 'Leave group?' })).toBeVisible();
    await ben.goBack();
    await expect(ben.getByRole('dialog', { name: 'Leave group?' })).toHaveCount(0);
    await groupArticle(ben, name).getByRole('button', { name: 'Leave group', exact: true }).click();
    await ben
      .getByRole('dialog', { name: 'Leave group?' })
      .getByRole('button', { name: 'Leave group', exact: true })
      .click();
    await expect(groupArticle(ben, name)).toHaveCount(0);
    expect([403, 404]).toContain((await ben.request.get('/api/groups/' + groupId)).status());
    await refresh(page);
    const annaRow = groupArticle(page, name)
      .locator('.member')
      .filter({ has: page.getByText('Anna', { exact: true }) });
    await annaRow.getByText('Manage Anna', { exact: true }).click();
    await annaRow.getByRole('button', { name: 'Remove member', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Remove member?' })
      .getByRole('button', { name: 'Remove member', exact: true })
      .click();
    await expect(groupArticle(page, name).getByText('Anna', { exact: true })).toHaveCount(0);
    expect([403, 404]).toContain((await anna.request.get('/api/groups/' + groupId)).status());
    await refresh(anna);
    await expect(groupArticle(anna, name)).toHaveCount(0);
  } finally {
    if (groupId)
      await page.request.delete('/api/groups/' + groupId, { headers: headers(baseURL!) });
    for (const c of contexts) await c.close();
  }
});

test('approval, invite rotation/revocation, Discover catechism range, admin and ownership transfer', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(browser.browserType().name() === 'webkit' ? 300000 : 150000);
  await page.goto('/');
  await login(page, 'Owner');
  const name = 'Approval circle ' + crypto.randomUUID().slice(0, 8);
  const created = await create(page, name, true);
  const id = created.group.id;
  const context = await browser.newContext({
      baseURL,
      viewport: { width: 320, height: 852 },
      serviceWorkers: 'block',
      extraHTTPHeaders: { 'CF-Connecting-IP': testIp() },
    }),
    friend = await context.newPage();
  try {
    const old = created.invite;
    const current = await invite(page, name);
    await friend.goto('/');
    await login(friend, 'Friend');
    await openGroups(friend);
    await form(friend, 'join');
    await groups(friend).getByLabel('Invite code', { exact: true }).fill(old.code);
    await groups(friend).getByRole('button', { name: 'Join group', exact: true }).click();
    await expect(groups(friend).getByRole('alert')).toBeVisible();
    await groups(friend).getByLabel('Invite code', { exact: true }).fill(current.code);
    await groups(friend).getByRole('button', { name: 'Join group', exact: true }).click();
    await expect(
      groups(friend).getByText('Waiting for Owner to approve.', { exact: true }).first(),
    ).toBeVisible();
    await expect(groupArticle(friend, name)).toHaveCount(0);
    await friend.reload();
    await openGroups(friend);
    const requests = groups(friend).getByRole('region', {
      name: 'Your join requests',
      exact: true,
    });
    await expect(requests).toContainText(name);
    await requests.getByRole('button', { name: 'Withdraw request', exact: true }).click();
    await expect(requests).toHaveCount(0);
    await expect(
      groups(friend).getByText('Join request withdrawn.', { exact: true }),
    ).toBeVisible();
    await form(friend, 'join');
    await groups(friend).getByLabel('Invite code', { exact: true }).fill(current.code);
    await groups(friend).getByRole('button', { name: 'Join group', exact: true }).click();
    await expect(
      groups(friend).getByRole('region', { name: 'Your join requests', exact: true }),
    ).toContainText(name);
    await refresh(page);
    await expect(
      navigation(page).getByRole('button', { name: 'Groups', exact: true }),
    ).toHaveAccessibleDescription('1 pending request');
    await expect(groups(page).getByLabel('1 pending request', { exact: true })).toHaveCount(1);
    await groupArticle(page, name).getByText('Manage group', { exact: true }).click();
    await groupArticle(page, name)
      .getByRole('button', { name: 'Decline Friend', exact: true })
      .click();
    await expect(
      groupArticle(page, name).getByText('Request declined.', { exact: true }),
    ).toBeVisible();
    await expect(
      navigation(page).getByRole('button', { name: 'Groups', exact: true }),
    ).toHaveAccessibleDescription('');
    await expect(groups(page).getByLabel('1 pending request', { exact: true })).toHaveCount(0);
    await refresh(friend);
    await expect(
      groups(friend).getByRole('region', { name: 'Your join requests', exact: true }),
    ).toHaveCount(0);
    await expect(groupArticle(friend, name)).toHaveCount(0);
    await form(friend, 'join');
    await groups(friend).getByLabel('Invite code', { exact: true }).fill(current.code);
    await groups(friend).getByRole('button', { name: 'Join group', exact: true }).click();
    await expect(
      groups(friend).getByText('Waiting for Owner to approve.', { exact: true }).first(),
    ).toBeVisible();
    await refresh(page);
    await expect(
      navigation(page).getByRole('button', { name: 'Groups', exact: true }),
    ).toHaveAccessibleDescription('1 pending request');
    await expect(groups(page).getByLabel('1 pending request', { exact: true })).toHaveCount(1);
    const article = groupArticle(page, name);
    await article.getByText('Manage group', { exact: true }).click();
    await article.getByRole('button', { name: 'Approve Friend', exact: true }).click();
    await expect(article.getByText('Member approved.', { exact: true })).toBeVisible();
    await expect(
      navigation(page).getByRole('button', { name: 'Groups', exact: true }),
    ).toHaveAccessibleDescription('');
    await expect(groups(page).getByLabel('1 pending request', { exact: true })).toHaveCount(0);
    await refresh(friend);
    await expect(groupArticle(friend, name)).toBeVisible();
    await article.getByRole('button', { name: 'Choose goal in Discover', exact: true }).click();
    await page.getByRole('button', { name: 'Catechisms & creeds', exact: true }).click();
    await page
      .locator('.document-cards')
      .getByRole('button', { name: /Westminster Shorter Catechism/ })
      .click();
    const goal = page.getByRole('form', { name: 'Choose a group goal', exact: true });
    await goal.getByLabel('From question or article').fill('1');
    await goal.getByLabel('Through question or article').fill('3');
    await goal.getByRole('button', { name: 'Use as group goal', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Groups', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      groupArticle(page, name).getByRole('region', { name: 'Group goal' }),
    ).toContainText('3 items');
    await groupArticle(page, name)
      .getByRole('button', { name: 'Add goal to my library', exact: true })
      .click();
    await expect(
      groupArticle(page, name).getByText('Goal added to your library.', { exact: true }),
    ).toBeVisible();
    const row = groupArticle(page, name)
      .locator('.member')
      .filter({ has: page.getByText('Friend', { exact: true }) });
    await row.getByText('Manage Friend', { exact: true }).click();
    await row.getByRole('combobox', { name: 'Role for Friend', exact: true }).selectOption('admin');
    await expect(row.getByText('Role updated.', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Transfer ownership to Friend', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Transfer ownership?' })
      .getByRole('button', { name: 'Transfer ownership', exact: true })
      .click();
    await expect(groupArticle(page, name).getByText('2 members · You are a member')).toBeVisible();
    await refresh(friend);
    await fits(friend, 320);
    await groupArticle(friend, name).getByText('Manage group', { exact: true }).click();
    await groupArticle(friend, name)
      .getByRole('button', { name: 'Revoke invite', exact: true })
      .click();
    await expect(
      groupArticle(friend, name).getByText('Invite revoked.', { exact: true }),
    ).toBeVisible();
    await groupArticle(friend, name)
      .getByRole('button', { name: 'Delete group', exact: true })
      .click();
    await friend
      .getByRole('dialog', { name: 'Delete group?' })
      .getByRole('button', { name: 'Delete group', exact: true })
      .click();
    await expect(groupArticle(friend, name)).toHaveCount(0);
    await refresh(page);
    await expect(groupArticle(page, name)).toHaveCount(0);
  } finally {
    await page.request.delete('/api/groups/' + id, { headers: headers(baseURL!) });
    await friend.request.delete('/api/groups/' + id, { headers: headers(baseURL!) });
    await context.close();
  }
});

test('initial sign-in sync preserves a display-name edit made before blur', async ({ page }) => {
  await page.goto('/');
  await settings(page);
  const email = `settings-race-${crypto.randomUUID()}@example.com`;
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const code = (
    await checked(await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email)))
  ).code;

  let release!: () => void, held!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const initialHeld = new Promise<void>((resolve) => (held = resolve));
  let first = true;
  await page.route('**/api/sync', async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    // Let the real server process the initial request; delay only its response.
    const response = await route.fetch();
    held();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await verifyEmail(page, code);
    // Hold the first sync in the returned app while editing the reopened settings.
    await initialHeld;
    const name = page.getByLabel('Display name', { exact: true });
    await name.fill('Friend');
    await expect(name).toBeFocused();
    release();

    // A response event alone does not prove App.svelte has merged/persisted it.
    // This commit barrier works on both old and fixed code and does not blur.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string | undefined>((resolve, reject) => {
              const open = indexedDB.open('byheart', 1);
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const db = open.result,
                  tx = db.transaction('state'),
                  read = tx.objectStore('state').get('current');
                let value: string | undefined;
                read.onsuccess = () => (value = read.result?.settings?.name);
                tx.oncomplete = () => {
                  db.close();
                  resolve(value);
                };
                tx.onabort = () => {
                  db.close();
                  reject(tx.error);
                };
              };
            }),
        ),
      )
      .toBe('Friend');
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Friend');

    const outgoing = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/sync' &&
        request.method() === 'POST' &&
        request.postDataJSON()?.settings?.name === 'Friend',
    );
    await name.press('Tab');
    const sent = (await outgoing).postDataJSON().settings;
    expect(sent.fieldUpdatedAt?.name).toBeGreaterThan(0);
    await expect
      .poll(async () => (await checked(await page.request.get('/api/export'))).settings.name)
      .toBe('Friend');
    await expect
      .poll(
        async () =>
          (await checked(await page.request.get('/api/export'))).settings.fieldUpdatedAt?.name,
      )
      .toBeGreaterThan(0);
    await page.reload();
    await settings(page);
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Friend');
  } finally {
    release();
  }
});

async function captureJoinState(page: Page, state: string, project: string) {
  const directory = process.env.GROUP_JOIN_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: join(directory, `${state}-${project}.png`), scale: 'css' });
}

test('invites and code joins ask unnamed members first, sync their name, and foreground pending requests', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  await page.goto('/');
  await login(page, 'Test Owner');
  const name = 'Sunday circle ' + crypto.randomUUID().slice(0, 8);
  const created = await create(page, name, true);
  const contexts: BrowserContext[] = [];
  let release = () => {};
  const member = async () => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 393, height: 852 },
      serviceWorkers: 'block',
      colorScheme: info.project.use.colorScheme as 'light' | 'dark',
      extraHTTPHeaders: { 'CF-Connecting-IP': testIp() },
    });
    contexts.push(context);
    return context.newPage();
  };
  try {
    const anna = await member();
    let joins = 0;
    anna.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/groups/join') joins++;
    });
    await anna.goto(new URL(created.invite.url, baseURL).href);
    await expect(
      groups(anna).getByRole('heading', { name: 'You’re invited to join a group', exact: true }),
    ).toBeVisible();
    const signIn = groups(anna).getByRole('button', { name: 'Sign in to join', exact: true });
    await expect(signIn).toBeVisible();
    await expect(signIn).not.toHaveClass(/secondary/);
    await expect(groups(anna).getByRole('button')).toHaveCount(1);
    await expect(
      groups(anna).getByRole('button', { name: 'Create a group', exact: true }),
    ).toHaveCount(0);
    await expect(
      groups(anna).getByRole('button', { name: 'Join with a code', exact: true }),
    ).toHaveCount(0);
    await captureJoinState(anna, 'signed-out-invite', info.project.name);
    await signIn.click();
    await expect(anna.getByLabel('Email address', { exact: true })).toBeVisible();
    await login(anna, '');
    await openGroups(anna);
    const prompt = groups(anna).getByRole('form', { name: 'Introduce yourself', exact: true });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByLabel('Your name in groups', { exact: true })).toHaveValue('');
    expect(joins).toBe(0);
    await captureJoinState(anna, 'inline-name', info.project.name);
    const before = (await checked(await anna.request.get('/api/export'))).settings;
    let held!: () => void;
    const heldSync = new Promise<void>((resolve) => {
      held = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await anna.route('**/api/sync', async (route) => {
      if (route.request().postDataJSON()?.settings?.name !== 'Anna') return route.continue();
      const response = await route.fetch();
      held();
      await gate;
      await route.fulfill({ response });
    });
    await prompt.getByLabel('Your name in groups', { exact: true }).fill(' Anna ');
    await prompt.getByRole('button', { name: 'Save name and continue', exact: true }).click();
    await heldSync;
    expect(joins).toBe(0); // Even a held in-flight sync must finish before joining.
    release();
    const requests = groups(anna).getByRole('region', { name: 'Your join requests', exact: true });
    await expect(requests).toContainText(name);
    await expect(requests).toContainText('Waiting for Test Owner to approve.');
    await expect(
      requests.getByRole('button', { name: 'Withdraw request', exact: true }),
    ).toBeVisible();
    await expect(groups(anna).getByLabel('Group name', { exact: true })).not.toBeVisible();
    await expect(groups(anna).getByLabel('Invite code', { exact: true })).not.toBeVisible();
    await expect(
      groups(anna).getByRole('button', { name: 'Create a group', exact: true }),
    ).toHaveCount(0);
    await captureJoinState(anna, 'pending-approval', info.project.name);
    expect(joins).toBe(1);
    const saved = (await checked(await anna.request.get('/api/export'))).settings;
    expect(saved.name).toBe('Anna');
    expect(saved.fieldUpdatedAt.name).toBeGreaterThan(before.fieldUpdatedAt?.name || 0);
    for (const [field, clock] of Object.entries(before.fieldUpdatedAt || {}))
      if (!['name', 'displayName'].includes(field))
        expect(saved.fieldUpdatedAt[field], field).toBe(clock);
    await refresh(page);
    await groupArticle(page, name).getByText('Manage group', { exact: true }).click();
    await expect(
      groupArticle(page, name).getByRole('button', { name: 'Approve Anna', exact: true }),
    ).toBeVisible();
    await groupArticle(page, name)
      .getByRole('button', { name: 'Approve Anna', exact: true })
      .click();
    await expect(
      groupArticle(page, name).getByText('Member approved.', { exact: true }),
    ).toBeVisible();
    await refresh(anna);
    await expect(groupArticle(anna, name).getByText('Anna (you)', { exact: true })).toBeVisible();
    await settings(anna);
    await expect(anna.getByLabel('Display name', { exact: true })).toHaveValue('Anna');

    const ben = await member();
    await ben.goto('/');
    await login(ben, '');
    await openGroups(ben);
    await form(ben, 'join');
    await groups(ben).getByLabel('Invite code', { exact: true }).fill(created.invite.code);
    await groups(ben).getByRole('button', { name: 'Join group', exact: true }).click();
    const codePrompt = groups(ben).getByRole('form', { name: 'Introduce yourself', exact: true });
    await expect(codePrompt).toBeVisible();
    expect(
      (await checked(await page.request.get('/api/groups/' + created.group.id))).group.pending,
    ).toHaveLength(0);
    await codePrompt.getByLabel('Your name in groups', { exact: true }).fill('Ben');
    await codePrompt.getByRole('button', { name: 'Save name and continue', exact: true }).click();
    await expect(
      groups(ben).getByRole('region', { name: 'Your join requests', exact: true }),
    ).toContainText(name);
    await refresh(page);
    await groupArticle(page, name).getByText('Manage group', { exact: true }).click();
    await expect(
      groupArticle(page, name).getByRole('button', { name: 'Approve Ben', exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await page.request.delete('/api/groups/' + created.group.id, { headers: headers(baseURL!) });
    for (const context of contexts) await context.close();
  }
});

test('creation asks for a name and a deleted remembered group waits for the list before detail', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  await login(page, '');
  await openGroups(page);
  await form(page, 'create');
  const name = 'New circle ' + crypto.randomUUID().slice(0, 8);
  await groups(page).getByLabel('Group name', { exact: true }).fill(name);
  await groups(page).getByRole('button', { name: 'Create group', exact: true }).click();
  const prompt = groups(page).getByRole('form', { name: 'Introduce yourself', exact: true });
  await expect(prompt).toBeVisible();
  expect((await checked(await page.request.get('/api/groups'))).groups).toHaveLength(0);
  await prompt.getByLabel('Your name in groups', { exact: true }).fill('New Owner');
  // Failed settings sync must leave the introduction retryable, without creating a group.
  let failSync = true;
  await page.route('**/api/sync', (route) =>
    failSync
      ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } })
      : route.continue(),
  );
  await prompt.getByRole('button', { name: 'Save name and continue', exact: true }).click();
  await expect(prompt.getByRole('alert')).toHaveText(
    'Your name could not sync. Please try again when you are online.',
  );
  expect((await checked(await page.request.get('/api/groups'))).groups).toHaveLength(0);
  failSync = false;
  await prompt.getByRole('button', { name: 'Save name and continue', exact: true }).click();
  await expect(groupArticle(page, name)).toBeVisible();
  await expect(
    groupArticle(page, name).getByText('New Owner (you)', { exact: true }),
  ).toBeVisible();
  const id = (await checked(await page.request.get('/api/groups'))).groups[0].id;
  await tab(page, 'Today');
  await checked(await page.request.delete('/api/groups/' + id, { headers: headers(baseURL!) }));
  let details = 0,
    release!: () => void,
    held!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const heldList = new Promise<void>((resolve) => {
    held = resolve;
  });
  await page.route('**/api/groups', async (route) => {
    const response = await route.fetch();
    held();
    await gate;
    await route.fulfill({ response });
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/groups/' + id) details++;
  });
  try {
    await tab(page, 'Groups');
    await heldList;
    await expect(groups(page).getByText('Loading your groups…', { exact: true })).toBeVisible();
    expect(details).toBe(0);
    release();
    await expect(
      groups(page).getByRole('button', { name: 'Create a group', exact: true }),
    ).toBeVisible();
    expect(details).toBe(0);
    await expect(groups(page).getByRole('alert')).toHaveCount(0);
  } finally {
    release();
  }
});

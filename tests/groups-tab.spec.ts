import { test, expect, type Page, type Locator } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation', exact: true });
const tap = async (button: Locator) => {
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
};
const tab = async (page: Page, name: string) => {
  const button = nav(page).getByRole('button', { name, exact: true });
  await tap(button);
  await expect(button).toHaveAttribute('aria-current', 'page');
};
const panel = (page: Page) => page.getByRole('region', { name: 'Groups', exact: true });
type Attention = {
  pendingRequests: number;
  prayersToday: number;
  goalsNearlyDone: number;
  groupId?: string;
};
async function account(page: Page, attention: Attention, empty = false) {
  let lists = 0,
    details = 0;
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { user: { id: 'groups-tab-test', name: 'Reader' } } }),
  );
  await page.route('**/api/sync', (route) => route.fulfill({ json: { items: [], events: [] } }));
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const group = {
    id,
    name: 'Small circle',
    role: 'owner',
    memberCount: 1,
    goal: null,
    pending: [],
    approveNewMembers: true,
    weeklyPush: false,
    members: [],
  };
  await page.route('**/api/groups', (route) => {
    lists++;
    return route.fulfill({ json: { groups: empty ? [] : [group], pending: [], attention } });
  });
  await page.route('**/api/groups/' + id, (route) => {
    details++;
    return route.fulfill({ json: { group } });
  });
  return { lists: () => lists, details: () => details, id };
}
async function capture(page: Page, name: string) {
  if (process.env.GROUPS_SCREENSHOT_DIR)
    await page.screenshot({ path: process.env.GROUPS_SCREENSHOT_DIR + '/' + name + '.png' });
}
for (const width of [320, 393])
  test(`four calm tabs fit ${width}px and Groups has a signed-out invitation`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/');
    await expect(nav(page).getByRole('button')).toHaveText([
      'Today',
      'Library',
      'Discover',
      'Groups',
    ]);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.group-attention')).toHaveCount(0);
    const buttons = await nav(page)
      .getByRole('button')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const b = node.getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            width: b.width,
            height: b.height,
            scroll: node.scrollWidth,
            client: node.clientWidth,
          };
        }),
      );
    for (const b of buttons) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(width);
      expect(b.scroll).toBeLessThanOrEqual(b.client);
    }
    await capture(page, `after-${info.project.name}-${width}-today`);
    await tab(page, 'Groups');
    await expect(
      page.getByRole('heading', { name: 'Groups', level: 1, exact: true }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('heading', {
        name: 'Memorize together with a small circle',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('button', { name: 'Create a group', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      panel(page).getByRole('button', { name: 'Join with a code', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Refresh group', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await capture(page, `after-${info.project.name}-${width}-groups-empty`);
    await tap(panel(page).getByRole('button', { name: 'Join with a code', exact: true }));
    await expect(
      page.getByRole('heading', { name: 'Account', level: 1, exact: true }),
    ).toBeVisible();
  });
for (const [kind, attention, text] of [
  [
    'approval',
    { pendingRequests: 2, prayersToday: 0, goalsNearlyDone: 0 },
    '2 join requests to review',
  ],
  [
    'prayer',
    { pendingRequests: 0, prayersToday: 1, goalsNearlyDone: 0 },
    'Someone prayed for you today',
  ],
  [
    'goal',
    { pendingRequests: 0, prayersToday: 0, goalsNearlyDone: 1 },
    'Your group goal is almost complete',
  ],
] as const)
  test(`Today shows only compact ${kind} attention; badge belongs to Groups`, async ({
    page,
  }, info) => {
    const state = await account(page, {
      ...attention,
      groupId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    await page.goto('/');
    const attentionCard = page.locator('.group-attention');
    await expect(attentionCard).toHaveText(new RegExp(text));
    await expect(panel(page)).toHaveCount(0);
    await expect(attentionCard).toHaveAccessibleName(text);
    await expect(attentionCard).toBeInViewport({ ratio: 1 });
    expect((await attentionCard.boundingBox())!.height).toBeLessThanOrEqual(52);
    const groupsTab = nav(page).getByRole('button', { name: 'Groups', exact: true });
    if (kind === 'approval') {
      await expect(groupsTab.locator('.tab-badge')).toHaveText('2');
      await expect(groupsTab).toHaveAccessibleDescription('2 pending requests');
    } else await expect(nav(page).locator('.tab-badge')).toHaveCount(0);
    await capture(page, `after-${info.project.name}-${kind}-attention`);
    await tap(attentionCard);
    await expect(groupsTab).toHaveAttribute('aria-current', 'page');
    await expect(
      panel(page).getByRole('article', { name: 'Small circle', exact: true }),
    ).toBeVisible();
    expect(state.details()).toBeGreaterThan(0);
    await capture(page, `after-${info.project.name}-${kind}-groups`);
    await expect(
      panel(page).getByRole('button', { name: 'Refresh group', exact: true }),
    ).toHaveCount(0);
  });
test('Groups refreshes on tab entry, focus, visible resume and downward pull', async ({ page }) => {
  const state = await account(page, { pendingRequests: 0, prayersToday: 0, goalsNearlyDone: 0 });
  await page.goto('/');
  await expect.poll(state.lists).toBeGreaterThan(0);
  const enter = state.lists();
  await tab(page, 'Groups');
  await expect.poll(state.lists).toBeGreaterThan(enter);
  await expect(panel(page).getByRole('article')).toBeVisible();
  await expect(panel(page).getByRole('article')).toHaveAttribute('aria-busy', 'false');
  for (const event of ['focus', 'visibilitychange']) {
    const before = state.lists();
    await page.evaluate((event) => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    }, event);
    await expect.poll(state.lists).toBeGreaterThan(before);
    await expect(panel(page).getByRole('article')).toHaveAttribute('aria-busy', 'false');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const beforePull = state.lists();
  await panel(page).evaluate((node) => {
    const target = node.querySelector('p') || node;
    const start = { identifier: 7, target, clientX: 100, clientY: 80 };
    const dispatch = (type: string, touches: object[], changedTouches: object[] = []) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        changedTouches: { value: changedTouches },
      });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', [start]);
    dispatch('touchend', [], [{ ...start, clientY: 180 }]);
  });
  await expect.poll(state.lists).toBeGreaterThan(beforePull);
  await expect(panel(page).getByRole('article')).toHaveAttribute('aria-busy', 'false');
  const beforeReopen = state.lists();
  await tab(page, 'Today');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.group-attention')).toHaveCount(0);
  await tab(page, 'Groups');
  await expect.poll(state.lists).toBeGreaterThan(beforeReopen);
});
test('join deep link opens Groups before sign-in and survives a new document', async ({ page }) => {
  await page.goto('/join/abcd-efgh-jkmn-pqrs');
  await expect(nav(page).getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(panel(page)).toBeVisible();
  const next = await page.context().newPage();
  await next.goto('/join/abcd-efgh-jkmn-pqrs');
  await expect(nav(next).getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(panel(next)).toBeVisible();
  await next.close();
});

for (const empty of [false, true])
  test(`background refresh is coalesced and preserves ${empty ? 'empty' : 'populated'} Groups layout`, async ({
    page,
  }) => {
    const state = await account(
      page,
      { pendingRequests: 0, prayersToday: 0, goalsNearlyDone: 0 },
      empty,
    );
    await page.goto('/');
    await tab(page, 'Groups');
    const anchor = empty
      ? panel(page).getByRole('heading', {
          name: 'Memorize together with a small circle',
          exact: true,
        })
      : panel(page).getByRole('article');
    await expect(anchor).toBeVisible();
    if (!empty) await expect(anchor).toHaveAttribute('aria-busy', 'false');
    const before = (await anchor.boundingBox())!,
      beforeLists = state.lists();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let requested = 0;
    await page.route('**/api/groups', async (route) => {
      requested++;
      await gate;
      await route.fallback();
    });
    try {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => requested).toBe(1);
      await expect(anchor).toBeVisible();
      const during = (await anchor.boundingBox())!;
      expect(during.y).toBeCloseTo(before.y, 1);
      await expect(panel(page).getByText('Refreshing…', { exact: true })).toHaveCount(0);
      await expect(panel(page).getByText('Loading your groups…', { exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await expect.poll(state.lists).toBeGreaterThan(beforeLists);
    if (!empty) await expect(anchor).toHaveAttribute('aria-busy', 'false');
    await expect(anchor).toBeVisible();
  });

test('empty-state sign-in returns to Groups and clears its return intent', async ({ page }) => {
  let signedIn = false;
  const user = { id: 'groups-sign-in-test', name: 'Reader' };
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { user: signedIn ? user : null } }),
  );
  await page.route('**/api/sync', (route) => route.fulfill({ json: { items: [], events: [] } }));
  await page.route('**/api/groups', (route) =>
    route.fulfill({
      json: {
        groups: [],
        pending: [],
        attention: { pendingRequests: 0, prayersToday: 0, goalsNearlyDone: 0 },
      },
    }),
  );
  await page.route('**/api/auth/email/start', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/auth/email/verify', (route) => {
    signedIn = true;
    return route.fulfill({ json: { user } });
  });
  await page.goto('/');
  await tab(page, 'Groups');
  await tap(panel(page).getByRole('button', { name: 'Create a group', exact: true }));
  await expect(page.getByRole('heading', { name: 'Account', level: 1, exact: true })).toBeVisible();
  await page.goBack();
  await expect(nav(page).getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await page.evaluate(() => sessionStorage.getItem('bh_groups_return'))).toBeNull();
  await tap(panel(page).getByRole('button', { name: 'Create a group', exact: true }));
  await page.getByLabel('Email address', { exact: true }).fill('reader@example.com');
  await tap(page.getByRole('button', { name: 'Email me a code', exact: true }));
  await page.getByLabel('Six-digit code').fill('123456');
  await expect(nav(page).getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    panel(page).getByRole('heading', {
      name: 'Memorize together with a small circle',
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('bh_groups_return'))).toBeNull();
});

test('scored practice refreshes attention after its queued sync, not an older in-flight sync', async ({
  page,
}) => {
  let release!: () => void, held!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    initialHeld = new Promise<void>((resolve) => (held = resolve));
  let syncs = 0,
    uploadedLearned = false,
    attentionAfterScore = 0;
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { user: { id: 'scored-sync-test', name: 'Reader' } } }),
  );
  await page.route('**/api/sync', async (route) => {
    if (++syncs === 1) {
      held();
      await gate;
    }
    const body = route.request().postDataJSON();
    uploadedLearned = body.items.some((item: any) => item.learned);
    await route.fulfill({ json: { items: [], events: [] } });
  });
  await page.route('**/api/groups', (route) => {
    if (uploadedLearned) attentionAfterScore++;
    return route.fulfill({
      json: {
        groups: [],
        pending: [],
        attention: {
          pendingRequests: 0,
          prayersToday: 0,
          goalsNearlyDone: uploadedLearned ? 1 : 0,
        },
      },
    });
  });
  await page.goto('/');
  await initialHeld;
  try {
    await tab(page, 'Discover');
    await tap(page.getByRole('button', { name: 'Add your own', exact: true }));
    await tap(page.getByRole('button', { name: 'Your text', exact: true }));
    await page.getByLabel('Title or question', { exact: true }).fill('One word');
    await page.getByLabel('Text to remember', { exact: true }).fill('One');
    await tap(page.getByRole('button', { name: 'Add your text', exact: true }));
    await expect(page.getByText('1 item added to your library.', { exact: true })).toBeVisible();
    await tab(page, 'Today');
    await tap(page.getByRole('button', { name: 'Begin', exact: true }));
    await tap(page.getByRole('button', { name: 'I know this', exact: true }));
    await expect(page.getByLabel('Practice', { exact: true })).toBeFocused();
    await page.keyboard.press('o');
    await expect(page.locator('.learned')).toBeVisible();
    expect(syncs).toBe(1);
  } finally {
    release();
  }
  await expect.poll(() => uploadedLearned).toBe(true);
  await expect.poll(() => attentionAfterScore).toBeGreaterThan(0);
  await tap(page.getByRole('button', { name: 'Back to Today', exact: true }));
  await expect(page.locator('.group-attention')).toHaveAccessibleName(
    'Your group goal is almost complete',
  );
});

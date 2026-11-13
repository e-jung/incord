import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Each test receives a fresh browser context/IndexedDB. Auth calls use the real
// local Worker and a CDP authenticator; only external push delivery is mocked.
async function screen(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir('test-results/screens', { recursive: true });
  await page.screenshot({ path: `test-results/screens/${info.project.name}-${name}.png`, fullPage: true, animations: 'disabled' });
  await expect(page.locator('body')).not.toHaveJSProperty('scrollWidth', 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function tab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}
async function account(page: Page) {
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your space', exact: true })).toBeVisible();
}
async function addOwn(page: Page, title = 'A quiet word', text = 'Grace and peace be with you always.') {
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Your own text', exact: true }).click();
  await page.getByLabel('Title or question').fill(title);
  await page.getByLabel('Text to remember').fill(text);
  await page.getByRole('button', { name: 'Add your text', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
}
async function beginOwn(page: Page, title = 'A quiet word') {
  await tab(page, 'Today');
  await page.getByRole('button').filter({ has: page.locator('b', { hasText: title }) }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function step(page: Page, n: number) {
  await expect(page.getByText(new RegExp(`^Step ${n} of 4`))).toBeVisible();
}
// Read token labels as a person reads the prompt. This does not import the
// engine's masking, grading, or transition implementation into the assertions.
async function typePassage(page: Page, options: { wrong?: boolean; onscreen?: boolean; peek?: boolean } = {}) {
  const words = await page.locator('[data-word]').allTextContents();
  expect(words.length).toBeGreaterThan(0);
  for (const word of words) {
    const initial = word.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1).toLowerCase();
    const key = options.wrong ? (initial === 'z' ? 'x' : 'z') : initial;
    if (options.peek) await page.getByRole('button', { name: 'Peek', exact: true }).click();
    else if (options.onscreen) await page.getByRole('button', { name: key.toUpperCase(), exact: true }).click();
    else await page.keyboard.press(key);
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function learned(page: Page) {
  await expect(page.getByRole('heading', { name: 'Learned.', exact: true })).toBeVisible();
  await expect(page.getByText(/Next review ·/)).toBeVisible();
}
async function register(page: Page, info?: TestInfo) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.getByRole('button', { name: 'Create account with a passkey', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your one-time recovery code' })).toBeVisible();
  const code = (await page.getByTestId('recovery-code').innerText()).trim();
  expect(code.length).toBeGreaterThanOrEqual(24);
  if (info) await screen(page, info, 'account-passkey-created');
  await page.getByRole('button', { name: 'I saved my code', exact: true }).click();
  await expect(page.getByText('Signed in. Your words travel with you.')).toBeVisible();
  return { code, cdp };
}

test.beforeEach(async ({ page, context }) => {
  // Isolate local rate-limit buckets from repeated runs and API security tests.
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `ui-${crypto.randomUUID()}` });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('empty Today, every tab, settings persistence, local export, and own-text validation', async ({ page }, info) => {
  await expect(page.getByText('Start with a word.')).toBeVisible();
  await screen(page, info, 'today-empty');
  await page.getByRole('button', { name: 'Find your first words' }).click();
  await expect(page.getByText('Your library starts with one small choice.')).toBeVisible();
  await screen(page, info, 'library-empty');
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
  await tab(page, 'Discover');
  await screen(page, info, 'discover-verses');
  await page.getByRole('button', { name: 'Your own text', exact: true }).click();
  await page.getByRole('button', { name: 'Add your text', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Add a title and some text.');
  await screen(page, info, 'discover-own-validation');
  await account(page);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use recovery code' })).toBeDisabled();
  await page.getByRole('button', { name: 'Enable reminders', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign in to enable reminders.');
  await screen(page, info, 'account-signed-out');
  await page.getByLabel('Display name').fill('Ada');
  await page.getByLabel('Display name').press('Tab');
  await page.getByLabel('Weekly rhythm').selectOption('5');
  await page.getByLabel('Reminder time', { exact: true }).fill('18:30');
  await page.getByLabel('Time zone', { exact: true }).fill('America/Los_Angeles');
  await page.getByLabel('Time zone', { exact: true }).press('Tab');
  const theme = info.project.name.endsWith('dark') ? 'dark' : 'light';
  await page.getByLabel('Appearance').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.reload();
  await account(page);
  await expect(page.getByLabel('Display name')).toHaveValue('Ada');
  await expect(page.getByLabel('Weekly rhythm')).toHaveValue('5');
  await expect(page.getByLabel('Reminder time', { exact: true })).toHaveValue('18:30');
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('America/Los_Angeles');
  await page.getByLabel('Appearance').selectOption(theme === 'dark' ? 'light' : 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  await page.getByLabel('Appearance').selectOption('system');
  await screen(page, info, 'account-settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export your data', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('by-heart.json');
  await expect(page.getByRole('status')).toHaveText('Your export is ready.');
  await tab(page, 'Today');
  await expect(page.getByText('0 of 5 days this week')).toBeVisible();
});

test('own words persist offline, collection detail buttons, restart and remove', async ({ page, context }, info) => {
  await addOwn(page, 'An original promise', '“Alpha,” Bravo’s Charlie-Delta Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu 1 2 3 4 5 6 7 8 9 0; 23 blessings.');
  await screen(page, info, 'library-own');
  await page.getByRole('button', { name: /Your own words.*0 of 1 learned/ }).click();
  await screen(page, info, 'collection-own');
  await page.getByRole('button', { name: 'Add items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
  await tab(page, 'Library');
  await page.getByRole('button', { name: /Your own words.*0 of 1 learned/ }).click();
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await typePassage(page, { onscreen: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await step(page, 2);
  await page.keyboard.press('g');
  await expect(page.locator('[data-word].done')).toHaveCount(1);
  await page.getByRole('button', { name: 'Restart step' }).click();
  await expect(page.locator('[data-word].done')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await context.setOffline(false);
  await tab(page, 'Library');
  await page.getByRole('button', { name: /Your own words.*0 of 1 learned/ }).click();
  await page.getByRole('button', { name: 'Remove An original promise', exact: true }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  await screen(page, info, 'collection-empty');
});

test('add BSB verse by reference and complete all four ladder steps', async ({ page }, info) => {
  await tab(page, 'Discover');
  await page.getByLabel('Bible reference').fill('John 3:16');
  await page.getByRole('button', { name: 'Find verses', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add to library', exact: true })).toBeVisible();
  await screen(page, info, 'verse-search-results');
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Added to your library.');
  await tab(page, 'Today');
  await screen(page, info, 'today-due');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  for (let n = 1; n <= 4; n++) {
    await step(page, n);
    const hidden = await page.locator('[data-hidden="true"]').count();
    if (n === 1) expect(hidden).toBe(0);
    else expect(hidden).toBeGreaterThan(0);
    await screen(page, info, `verse-step-${n}`);
    await typePassage(page, { onscreen: n === 2 });
    await expect(page.getByRole('dialog')).toHaveAccessibleName('Beautifully done.');
    await expect(page.getByRole('dialog')).toContainText('0 slips');
    await screen(page, info, `verse-result-${n}`);
    await page.getByRole('button', { name: n === 4 ? 'Keep it by heart' : 'Continue', exact: true }).click();
  }
  await learned(page);
  await screen(page, info, 'verse-learned');
  await page.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Done for today.', exact: true })).toBeVisible();
  await screen(page, info, 'today-done');
  await page.getByRole('button', { name: 'Visit your library', exact: true }).click();
  await page.getByRole('button', { name: /Your own words.*1 of 1 learned/ }).click();
  await page.getByRole('button', { name: /John 3:16.*Learned/ }).click();
  await expect(page.getByText('Review · blank recall')).toBeVisible();
  await screen(page, info, 'review-recall');
  await typePassage(page);
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Easy');
  await screen(page, info, 'review-easy');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Remembered.', exact: true })).toBeVisible();
  await screen(page, info, 'review-remembered');
  await page.getByRole('button', { name: 'Practice again', exact: true }).click();
  await step(page, 1);
});

test('catechism browse and complete a full ladder', async ({ page }, info) => {
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Catechisms & creeds', exact: true }).click();
  await screen(page, info, 'documents-picker');
  await page.getByRole('combobox', { name: 'Browse', exact: true }).selectOption({ label: 'Westminster Shorter Catechism' });
  await screen(page, info, 'documents-westminster');
  const addQuestion = page.getByRole('button', { name: /^Add .*Q(?:uestion)?\.?\s*1\b/i }).first();
  // Title format is content-owned; first Add button is Q1 in document order.
  const firstAdd = await addQuestion.count() ? addQuestion : page.locator('button.text-button').filter({ hasText: /^Add / }).first();
  const title = (await firstAdd.innerText()).replace(/^Add /, '');
  await firstAdd.click();
  await tab(page, 'Today');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  for (let n = 1; n <= 4; n++) {
    await step(page, n);
    await screen(page, info, `catechism-step-${n}`);
    await typePassage(page, { onscreen: n === 4 });
    await page.getByRole('button', { name: n === 4 ? 'Keep it by heart' : 'Continue', exact: true }).click();
  }
  await learned(page);
  await screen(page, info, 'catechism-learned');
});

test('failed step repeats, peek is a slip, result-close exits, shortcut fails to step 3 and then passes', async ({ page }, info) => {
  await addOwn(page);
  await beginOwn(page);
  await typePassage(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await step(page, 2);
  await typePassage(page, { peek: true });
  await expect(page.getByRole('dialog')).toHaveAccessibleName('A little more practice.');
  await screen(page, info, 'practice-failed');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await step(page, 2);
  await typePassage(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Close practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await addOwn(page, 'Shortcut challenge', 'Love is patient and love is kind.');
  await beginOwn(page, 'Shortcut challenge');
  await page.getByRole('button', { name: 'I know this', exact: true }).click();
  await step(page, 4);
  await screen(page, info, 'shortcut-blank');
  await typePassage(page, { wrong: true });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await step(page, 3);
  await screen(page, info, 'shortcut-fallback');
  await typePassage(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await typePassage(page);
  await page.getByRole('button', { name: 'Keep it by heart', exact: true }).click();
  await learned(page);
});

test('shortcut success and failed blank review returns to step 3', async ({ page }, info) => {
  await addOwn(page);
  await beginOwn(page);
  await page.getByRole('button', { name: 'I know this', exact: true }).click();
  await typePassage(page, { onscreen: true });
  await page.getByRole('button', { name: 'Keep it by heart', exact: true }).click();
  await learned(page);
  await page.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await tab(page, 'Library');
  await page.getByRole('button', { name: /Your own words.*1 of 1 learned/ }).click();
  await page.getByRole('button', { name: /A quiet word.*Learned/ }).click();
  await typePassage(page, { wrong: true });
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Again');
  await screen(page, info, 'review-again');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await step(page, 3);
});

test('passkey signup, sync, signout, signin, recovery rotation, export and account deletion', async ({ page }, info) => {
  await addOwn(page, 'Synced promise', 'Good words travel with you.');
  await account(page);
  await page.getByLabel('Display name').fill('Test pilgrim');
  await page.getByLabel('Display name').press('Tab');
  const { code, cdp } = await register(page, info);
  await screen(page, info, 'account-signed-in');
  await expect.poll(async () => {
    const synced = await page.request.get('/api/export');
    expect(synced.ok()).toBe(true);
    return JSON.stringify(await synced.json());
  }).toContain('Synced promise');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  await expect(page.getByText('Signed in. Your words travel with you.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('One-time recovery code').fill(code);
  await page.getByRole('button', { name: 'Use recovery code', exact: true }).click();
  await expect(page.getByTestId('recovery-code')).not.toHaveText(code);
  await screen(page, info, 'account-recovery-code');
  await page.getByRole('button', { name: 'I saved my code', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('One-time recovery code').fill(code);
  await page.getByRole('button', { name: 'Use recovery code', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid or already used recovery code');
  await screen(page, info, 'account-recovery-used');
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export your data', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('by-heart.json');
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await screen(page, info, 'account-delete-confirm');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByRole('button', { name: 'Keep account', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete account', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Account deleted. Local practice is still on this device.');
  expect((await page.request.get('/api/me')).status()).toBe(401);
  await screen(page, info, 'account-deleted');
  await tab(page, 'Today');
  await expect(page.getByRole('button', { name: /Synced promise/ })).toBeVisible();
  await cdp.detach();
});

test('push permission, mock subscription, test notification and disable', async ({ page }, info) => {
  const subscriptions: unknown[] = [];
  let notificationTests = 0;
  await page.route('**/api/config', route => route.fulfill({ json: { googleEnabled: false, vapidPublicKey: 'B' + 'A'.repeat(86) } }));
  await page.route('**/api/push/subscribe', async route => {
    subscriptions.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/push/test', async route => {
    notificationTests++;
    await route.fulfill({ json: { sent: true } });
  });
  await page.addInitScript(() => {
    const subscription = {
      endpoint: 'https://push.example.invalid/byheart-test',
      keys: { p256dh: 'mock-p256dh', auth: 'mock-auth' },
    };
    Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: async () => 'granted' });
    Object.defineProperty(PushManager.prototype, 'subscribe', { configurable: true, value: async () => ({ toJSON: () => subscription }) });
    Object.defineProperty(PushManager.prototype, 'getSubscription', { configurable: true, value: async () => ({ unsubscribe: async () => true }) });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await account(page);
  const { cdp } = await register(page, info);
  await page.getByRole('button', { name: 'Enable reminders', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Gentle reminders enabled.');
  expect(subscriptions).toEqual([{ subscription: { endpoint: 'https://push.example.invalid/byheart-test', keys: { p256dh: 'mock-p256dh', auth: 'mock-auth' } } }]);
  await screen(page, info, 'account-push-enabled');
  await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Test notification sent.');
  expect(notificationTests).toBe(1);
  await page.getByRole('button', { name: 'Disable reminders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable reminders', exact: true })).toBeVisible();
  expect(subscriptions.at(-1)).toEqual({ subscription: null });
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete account', exact: true }).click();
  await cdp.detach();
});

test('gentle return welcome caps the backlog at three items', async ({ page }, info) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const last = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const state = {
      settings: { name: '', theme: 'system', goal: 4, reminderTime: '19:00', timeZone: 'UTC', pushEnabled: false, days: [], lastActive: last },
      events: [], queue: [],
      items: Array.from({ length: 8 }, (_, n) => ({ id: `return-${n}`, title: `Familiar word ${n + 1}`, text: 'Peace be with you.', collection: 'personal', step: 1, learned: false, due: new Date(0).toISOString(), updatedAt: Date.now() })),
    };
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(state, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Welcome back.' })).toBeVisible();
  await screen(page, info, 'welcome-back');
  await page.getByRole('button', { name: 'A fresh start', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('3 little steps', { exact: true })).toBeVisible();
  await screen(page, info, 'today-gentle-return');
});


test('all starter covers and document choices, collection sessions and Next item', async ({ page }, info) => {
  await tab(page, 'Library');
  const covers = [
    'The Gospel in 10 verses', 'Westminster Shorter Catechism',
    'Heidelberg · Lord’s Day 1', 'The Apostles’ Creed', 'Psalm 23',
  ];
  for (let index = 0; index < covers.length; index++) {
    await page.locator('.covers').getByRole('button').filter({ has: page.locator('b', { hasText: covers[index] }) }).click();
    await expect(page.getByRole('heading', { level: 1, name: covers[index], exact: true })).toBeVisible();
    await screen(page, info, `starter-${index + 1}`);
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await step(page, 1);
    if (index === 0) {
      const title = await page.getByRole('heading', { level: 1 }).innerText();
      await page.getByRole('button', { name: 'I know this', exact: true }).click();
      await typePassage(page);
      await page.getByRole('button', { name: 'Keep it by heart', exact: true }).click();
      await learned(page);
      await expect(page.getByRole('button', { name: 'Next item', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Next item', exact: true }).click();
      await step(page, 1);
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(title);
    }
    await page.getByRole('button', { name: 'Close practice', exact: true }).click();
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  }
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Catechisms & creeds', exact: true }).click();
  for (const doc of ['Heidelberg Catechism', 'Apostles’ Creed', 'Nicene Creed']) {
    await page.getByRole('combobox', { name: 'Browse', exact: true }).selectOption({ label: doc });
    await expect(page.locator('button.text-button').filter({ hasText: /^Add / }).first()).toBeVisible();
    await screen(page, info, `document-${doc.split(' ')[0].replace(/[^a-z]/gi, '').toLowerCase()}`);
  }
  await page.getByRole('button', { name: 'Add verses', exact: true }).click();
  await page.getByLabel('Bible reference').fill('not a Bible reference');
  await page.getByRole('button', { name: 'Find verses', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await screen(page, info, 'verse-search-invalid');
  for (const translation of ['KJV', 'WEB']) {
    await page.getByRole('combobox', { name: 'Translation', exact: true }).selectOption(translation);
    await page.getByLabel('Bible reference').fill('Romans 8:28-30');
    await page.getByLabel('Bible reference').press('Enter');
    await expect(page.getByRole('button', { name: 'Add to library', exact: true })).toBeVisible();
    await expect(page.locator('.row')).toHaveCount(3);
    await screen(page, info, `verse-search-${translation.toLowerCase()}`);
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Added to your library.');
    // Switching modes clears previous search results before the next request.
    await page.getByRole('button', { name: 'Your own text', exact: true }).click();
    await page.getByRole('button', { name: 'Add verses', exact: true }).click();
  }
});

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Each test receives a fresh browser context/IndexedDB. Auth calls use the real
// local Worker and email test sink; only external push delivery is mocked.
async function screen(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator('body').innerText()).not.toMatch(/\b(?:bible|wsc|personal)\b/);
  await mkdir('test-results/screens', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/screens/${info.project.name}-${name}.png`, fullPage: false, animations: 'disabled' });
  if (['today-due','library-empty','collection-own','documents-westminster','account-settings','verse-learned','document-nicene'].includes(name)) {
    await page.screenshot({ path: `test-results/screens/${info.project.name}-${name}-full.png`, fullPage: true, animations: 'disabled' });
  }
  await expect(page.locator('body')).not.toHaveJSProperty('scrollWidth', 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function tab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}
async function account(page: Page) {
  await tab(page, 'Today');
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
}
async function addOwn(page: Page, title = 'A quiet word', text = 'Grace and peace be with you always.') {
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Your text', exact: true }).click();
  await page.getByLabel('Title or question').fill(title);
  await page.getByLabel('Text to remember').fill(text);
  await page.getByRole('button', { name: 'Add your text', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My texts', exact: true })).toBeVisible();
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
    else if (options.onscreen) {
      const toggle=page.getByRole('button',{name:/^[0-9]$/.test(key)?'Show numbers':'Show letters',exact:true});
      if(await toggle.count())await toggle.click();
      await page.getByRole('button', { name: key.toUpperCase(), exact: true }).click();
    }
    else await page.keyboard.press(key);
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function learned(page: Page) {
  await expect(page.getByRole('heading', { name: 'Learned', level: 1, exact: true })).toBeVisible();
  await expect(page.getByText(/Next review ·/)).toBeVisible();
}
async function emailSignin(page: Page, email: string) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const response = await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email));
  expect(response.ok()).toBe(true);
  const { code } = await response.json();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('Six-digit code').fill(code);
  await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
}
async function register(page: Page, info?: TestInfo) {
  const email = `ui-${crypto.randomUUID()}@example.com`;
  await emailSignin(page, email);
  const merge = page.getByRole('dialog').filter({ hasText: /items? on this device/ });
  if (await merge.count()) await merge.getByRole('button', { name: 'Add', exact: true }).click();
  if (info) await screen(page, info, 'account-email-created');
  await expect(page.getByText('Signed in.', {exact:true})).toBeVisible();
  return {email};
}


async function signout(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Sign out on this device?' });
  await expect(confirm).toContainText('Your practice is saved to your account');
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
}

test.beforeEach(async ({ page, context }) => {
  // Isolate local rate-limit buckets from repeated runs and API security tests.
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `ui-${crypto.randomUUID()}` });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('empty Today, every tab, settings persistence, local export, and own-text validation', async ({ page }, info) => {
  await expect(page.getByText('No items yet')).toBeVisible();
  await screen(page, info, 'today-empty');
  await page.getByRole('button', { name: 'Browse Library' }).click();
  await expect(page.getByText('No items yet.')).toBeVisible();
  await screen(page, info, 'library-empty');
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
  await tab(page, 'Discover');
  await screen(page, info, 'discover-verses');
  await page.getByRole('button', { name: 'Your text', exact: true }).click();
  await page.getByRole('button', { name: 'Add your text', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Add a title and some text.');
  await screen(page, info, 'discover-own-validation');
  await account(page);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code', exact: true })).toBeEnabled();
  expect(await page.getByLabel('Email address', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  const reminders=page.getByRole('button', { name: 'Enable reminders', exact: true });
  if(await reminders.isEnabled()){await reminders.click();await expect(page.getByRole('alert')).toHaveText('Sign in to enable reminders.')}else{await expect(page.getByRole('region',{name:'Reminders',exact:true})).toContainText(/Permission denied|Add to Home Screen/)}
  await screen(page, info, 'account-signed-out');
  await page.getByLabel('Display name').fill('Ada');
  await page.getByLabel('Display name').press('Tab');
  await page.getByLabel('Weekly rhythm').selectOption('5');
  await page.getByLabel('Reminder time', { exact: true }).fill('18:30');
  await page.getByPlaceholder('Search time zones').fill('Los_Angeles');
  await page.getByRole('combobox', { name: 'Time zone', exact: true }).selectOption('America/Los_Angeles');
  const theme = info.project.name.endsWith('dark') ? 'dark' : 'light';
  await page.getByLabel('Appearance').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.reload();
  await account(page);
  await expect(page.getByLabel('Display name')).toHaveValue('Ada');
  await expect(page.getByLabel('Weekly rhythm')).toHaveValue('5');
  await expect(page.getByLabel('Reminder time', { exact: true })).toHaveValue('18:30');
  await expect(page.getByRole('combobox', { name: 'Time zone', exact: true })).toHaveValue('America/Los_Angeles');
  await page.getByLabel('Appearance').selectOption(theme === 'dark' ? 'light' : 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  await page.getByLabel('Appearance').selectOption('system');
  await screen(page, info, 'account-settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export your data', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('incord.json');
  await expect(page.getByRole('status')).toHaveText('Your export is ready.');
  await tab(page, 'Today');
  await expect(page.getByText('0 of 5 this week')).toBeVisible();
});

test('own words persist offline, collection detail buttons, restart and remove', async ({ page, context }, info) => {
  await addOwn(page, 'An original promise', '“Alpha,” Bravo’s Charlie-Delta Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu 1 2 3 4 5 6 7 8 9 0; 23 blessings.');
  await screen(page, info, 'library-own');
  await screen(page, info, 'collection-own');
  await page.getByRole('button', { name: 'Add items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
  await tab(page, 'Library');
  await page.getByRole('button', { name: /My texts.*0 of 1 learned/ }).click();
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
  await page.getByRole('button', { name: /My texts.*0 of 1 learned/ }).click();
  await page.getByRole('button', { name: 'Options for An original promise', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
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
  await expect(page.getByRole('status')).toHaveText(/\d+ items? added to your library\./);
  await tab(page, 'Today');
  await expect(page.getByText('1 to practice', { exact: true })).toBeVisible();
  await expect(page.getByText('About 2 min', { exact: true })).toBeVisible();
  await expect(page.locator('.row .translation-badge')).toHaveText('BSB');
  await expect(page.locator('.row small:not(.translation-badge)')).toHaveText('New');
  await screen(page, info, 'today-due');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  for (let n = 1; n <= 4; n++) {
    await step(page, n);
    const hidden = await page.locator('[data-hidden="true"]').count();
    if (n === 1) expect(hidden).toBe(0);
    else expect(hidden).toBeGreaterThan(0);
    const keyboard = await page.getByLabel('Practice keyboard').boundingBox();
    expect(keyboard).not.toBeNull();
    expect(Math.abs(keyboard!.y + keyboard!.height - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(page.viewportSize()!.height);
    await screen(page, info, `verse-step-${n}`);
    await typePassage(page, { onscreen: n === 2 });
    await expect(page.getByRole('dialog')).toHaveAccessibleName(n === 4 ? 'Learned' : `Step ${n} passed`);
    if (n > 1 && n < 4) await expect(page.getByRole('dialog')).toContainText(`${hidden} of ${hidden} from memory · 0 slips`);
    await screen(page, info, `verse-result-${n}`);
    await page.getByRole('button', { name: n === 4 ? 'Finish' : 'Continue', exact: true }).click();
  }
  await learned(page);
  await expect(page.locator('.keepsake')).toContainText('For God so loved the world');
  await expect(page.locator('.keepsake')).toContainText('John 3:16');
  await screen(page, info, 'verse-learned');
  await page.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Done for today', exact: true })).toBeVisible();
  await screen(page, info, 'today-done');
  await page.getByRole('button', { name: 'Visit your library', exact: true }).click();
  await page.getByRole('button', { name: /My verses.*1 of 1 learned/ }).click();
  await page.getByRole('button', { name: /^John 3:16/ }).click();
  await expect(page.getByText('Review · blank recall')).toBeVisible();
  await screen(page, info, 'review-recall');
  await typePassage(page);
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Solid');
  await screen(page, info, 'review-easy');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviewed', exact: true })).toBeVisible();
  await screen(page, info, 'review-remembered');
  await page.getByRole('button', { name: 'Practice once more', exact: true }).click();
  await step(page, 4);
});

test('catechism browse and complete a full ladder', async ({ page }, info) => {
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Catechisms', exact: true }).click();
  await screen(page, info, 'documents-picker');
  await page.getByRole('combobox', { name: 'Browse', exact: true }).selectOption({ label: 'Westminster Shorter Catechism' });
  await screen(page, info, 'documents-westminster');
  const title = (await page.locator('summary').first().innerText()).replace(/^Q1 · /, '');
  await expect(page.locator('details').first()).not.toHaveAttribute('open', '');
  await expect(page.locator('.document-add').first()).toHaveText('+');
  await page.getByRole('button', { name: 'Add Q1', exact: true }).click();
  await expect(page.locator('.document-add').first()).toHaveText('✓');
  await tab(page, 'Today');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.prompt')).toContainText('Westminster Shorter Catechism · Q1');
  for (let n = 1; n <= 4; n++) {
    await step(page, n);
    await screen(page, info, `catechism-step-${n}`);
    await typePassage(page, { onscreen: n === 4 });
    await page.getByRole('button', { name: n === 4 ? 'Finish' : 'Continue', exact: true }).click();
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
  await expect(page.getByRole('dialog')).toHaveAccessibleName('One more time');
  await screen(page, info, 'practice-failed');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await step(page, 2);
  await typePassage(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Close practice', exact: true }).click();
  await tab(page, 'Today');
  await addOwn(page, 'Shortcut challenge', 'Love is patient and love is kind.');
  await beginOwn(page, 'Shortcut challenge');
  await page.getByRole('button', { name: 'I know this', exact: true }).click();
  await step(page, 4);
  await screen(page, info, 'shortcut-blank');
  await typePassage(page, { wrong: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await step(page, 3);
  await screen(page, info, 'shortcut-fallback');
  await typePassage(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await typePassage(page);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await learned(page);
});

test('shortcut success and failed blank review returns to step 3', async ({ page }, info) => {
  await addOwn(page);
  await beginOwn(page);
  await page.getByRole('button', { name: 'I know this', exact: true }).click();
  await typePassage(page, { onscreen: true });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await learned(page);
  await page.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await tab(page, 'Library');
  await page.getByRole('button', { name: /My texts.*1 of 1 learned/ }).click();
  await page.getByRole('button', { name: /^A quiet word/ }).click();
  await typePassage(page, { wrong: true });
  await expect(page.getByRole('dialog')).toHaveAccessibleName("Let's relearn this");
  await screen(page, info, 'review-again');
  await page.getByRole('button', { name: 'Relearn now', exact: true }).click();
  await step(page, 3);
});

test('email signup, sync, signout, signin, export and account deletion', async ({ page }, info) => {
  await addOwn(page, 'Synced promise', 'Good words travel with you.');
  await account(page);
  await page.getByLabel('Display name').fill('Test pilgrim');
  await page.getByLabel('Display name').press('Tab');
  const { email } = await register(page, info);
  await screen(page, info, 'account-signed-in');
  await expect.poll(async () => {
    const synced = await page.request.get('/api/export');
    expect(synced.ok()).toBe(true);
    return JSON.stringify(await synced.json());
  }).toContain('Synced promise');
  await signout(page);
  await expect(page.getByRole('button', { name: 'Email me a code', exact: true })).toBeVisible();
  expect(await (await page.request.get('/api/me')).json()).toMatchObject({ user: null });
  await emailSignin(page, email);
  await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export your data', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('incord.json');
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
  const cached=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('byheart',1);r.onsuccess=()=>resolve(r.result)});const value:any=await new Promise(resolve=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>resolve(r.result)});db.close();return value.account});
  expect(cached).toBeNull();
  expect(await (await page.request.get('/api/me')).json()).toMatchObject({ user: null });
  await screen(page, info, 'account-deleted');
  await tab(page, 'Today');
  await expect(page.getByRole('button', { name: /Synced promise/ })).toBeVisible();
});

test('push permission, mock subscription, test notification and disable', async ({ page }, info) => {
  const subscriptions: unknown[] = [];
  let notificationTests = 0;
  await page.route('**/api/config', route => route.fulfill({ json: { email: true, googleEnabled: false, vapidPublicKey: 'B' + 'A'.repeat(86) } }));
  await page.route('**/api/push/subscribe', async route => {
    subscriptions.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/push/test', async route => {
    notificationTests++;
    await route.fulfill({ json: { sent: 1,failed:0,results:[{host:'web.push.apple.com',status:201,reason:''}] } });
  });
  await page.route('**/api/push/status*', route=>route.fulfill({json:{subscribed:true,results:[]}}));
  await page.addInitScript(() => {
    const subscription = {
      endpoint: 'https://push.example.invalid/byheart-test',
      keys: { p256dh: 'mock-p256dh', auth: 'mock-auth' },
    };
    let subscribed=false;
    Object.defineProperty(Notification,'permission',{configurable:true,get:()=>subscribed?'granted':'default'});
    Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: async () => {subscribed=true;return 'granted'} });
    Object.defineProperty(PushManager.prototype, 'subscribe', { configurable: true, value: async () => ({ endpoint:subscription.endpoint,toJSON: () => subscription }) });
    Object.defineProperty(PushManager.prototype, 'getSubscription', { configurable: true, value: async () => subscribed?({ endpoint:subscription.endpoint,toJSON:()=>subscription,unsubscribe: async () => {subscribed=false;return true} }):null });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await account(page);
  await register(page, info);
  await page.getByRole('button', { name: 'Enable reminders', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Gentle reminders enabled.');
  expect(subscriptions).toEqual([{ subscription: { endpoint: 'https://push.example.invalid/byheart-test', keys: { p256dh: 'mock-p256dh', auth: 'mock-auth' } } }]);
  await screen(page, info, 'account-push-enabled');
  await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText("Sent to Apple. If it didn't appear, check Settings → Notifications → Incord.");
  expect(notificationTests).toBe(1);
  await page.getByRole('button', { name: 'Disable reminders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable reminders', exact: true })).toBeVisible();
  expect(subscriptions.at(-1)).toEqual({ subscription: null,endpoint:'https://push.example.invalid/byheart-test' });
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete account', exact: true }).click();
});

for (const choice of ['Start', 'Check what I remember']) test(`gentle return welcome caps the backlog before and after ${choice}`, async ({ page }, info) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const last = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const state = {
      settings: { name: '', theme: 'system', goal: 4, reminderTime: '19:00', timeZone: 'UTC', pushEnabled: false, days: [], lastActive: last },
      events: [], queue: [],
      items: Array.from({ length: 8 }, (_, n) => ({ id: `return-${n}`, title: `Familiar word ${n + 1}`, text: 'Peace be with you.', collection: 'personal', step: 4, learned: true, due: new Date(0).toISOString(), updatedAt: Date.now() })),
    };
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(state, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('.hero')).toContainText('3 to practice');
  await expect(page.locator('.hero')).toContainText('About 1 min');
  await screen(page, info, 'welcome-back');
  await page.getByRole('button', { name: choice, exact: true }).click();
  if (choice !== 'Start') {
    await expect(page.getByRole('heading', { name: 'Familiar word 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('3 to practice', { exact: true })).toBeVisible();
  await expect(page.getByText('About 1 min', { exact: true })).toBeVisible();
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
    await expect(page.getByRole('dialog', { name: covers[index], exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add to my library', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: covers[index], exact: true })).toBeVisible();
    await screen(page, info, `starter-${index + 1}`);
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await step(page, 1);
    if (index === 0) {
      const title = await page.getByRole('heading', { level: 1 }).innerText();
      await page.getByRole('button', { name: 'I know this', exact: true }).click();
      await typePassage(page);
      await page.getByRole('button', { name: 'Finish', exact: true }).click();
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
  await page.getByRole('button', { name: 'Catechisms', exact: true }).click();
  for (const doc of ['Heidelberg Catechism', 'Apostles’ Creed', 'Nicene Creed']) {
    await page.getByRole('combobox', { name: 'Browse', exact: true }).selectOption({ label: doc });
    await expect(page.locator('.document-add').first()).toBeVisible();
    await screen(page, info, `document-${doc.split(' ')[0].replace(/[^a-z]/gi, '').toLowerCase()}`);
  }
  await page.getByRole('button', { name: 'Verses', exact: true }).click();
  await page.getByLabel('Bible reference').fill('not a Bible reference');
  await page.getByRole('button', { name: 'Find verses', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await screen(page, info, 'verse-search-invalid');
  for (const translation of ['KJV', 'WEB']) {
    await page.getByRole('combobox', { name: 'Default translation', exact: true }).selectOption(translation);
    await page.getByLabel('Bible reference').fill('Romans 8:28-30');
    await page.getByLabel('Bible reference').press('Enter');
    await expect(page.getByRole('button', { name: 'Add to library', exact: true })).toBeVisible();
    await expect(page.locator('.row')).toHaveCount(3);
    await screen(page, info, `verse-search-${translation.toLowerCase()}`);
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/\d+ items? added to your library\./);
    // Switching modes clears previous search results before the next request.
    await page.getByRole('button', { name: 'Your text', exact: true }).click();
    await page.getByRole('button', { name: 'Verses', exact: true }).click();
  }
});


test('375px segments fit and email input clears floating navigation', async ({page}, info) => {
  await page.setViewportSize({width:375,height:812});
  await tab(page, 'Discover');
  for (const label of ['Verses','Your text','Catechisms']) {
    const button=page.getByRole('button',{name:label,exact:true});
    await button.click();
    expect(await button.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect((await button.boundingBox())!.height).toBeLessThan(45);
  }
  await screen(page,info,'discover-375');
  await account(page);
  await page.getByLabel('Email address', {exact:true}).scrollIntoViewIfNeeded();
  const input=await page.getByLabel('Email address', {exact:true}).boundingBox();
  const nav=await page.getByRole('navigation').boundingBox();
  expect(input!.y+input!.height).toBeLessThan(nav!.y);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  const last=await page.getByText('Incord (from Latin', {exact:false}).boundingBox();
  expect(last!.y+last!.height).toBeLessThan(nav!.y);
});

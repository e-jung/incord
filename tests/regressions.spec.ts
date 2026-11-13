import { test, expect, type Page } from '@playwright/test';

async function tab(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
async function own(page: Page, title: string, text = 'Grace and peace remain with you.') {
  await tab(page, 'Discover');
  await page.getByRole('button', { name: 'Your text', exact: true }).click();
  await page.getByLabel('Title or question').fill(title);
  await page.getByLabel('Text to remember').fill(text);
  await page.getByRole('button', { name: 'Add your text', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My texts', exact: true })).toBeVisible();
}
async function openOwn(page: Page, title: string) {
  await tab(page, 'Library');
  await page.getByRole('button', { name: /^My texts/ }).click();
  await page.getByRole('button').filter({ has: page.locator('b', { hasText: title }) }).click();
}
async function state(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const value = await new Promise((resolve, reject) => { const r = db.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return value;
  });
}
async function type(page: Page, checkScroll = false) {
  const words = await page.locator('[data-word]').allTextContents();
  for (let i = 0; i < words.length; i++) {
    if (checkScroll) {
      await expect.poll(async () => page.locator(`[data-word="${i}"]`).evaluate(el => {
        const word = el.getBoundingClientRect(), box = el.parentElement!.getBoundingClientRect();
        const keyboard = document.querySelector('[aria-label="Practice keyboard"]')!.getBoundingClientRect();
        return word.top >= box.top - 1 && word.bottom <= Math.min(box.bottom, keyboard.top) + 1;
      })).toBe(true);
    }
    await page.keyboard.press(words[i].replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1).toLowerCase());
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function account(page: Page) {
  await tab(page, 'Today');
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
}
async function signup(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.getByRole('button', { name: 'Create account with a passkey', exact: true }).click();
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  // Registration with local items also requires explicit ownership confirmation.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: 'I saved my code', exact: true }).click();
  const merge = page.getByRole('dialog').filter({ hasText: /items? on this device/ });
  if (await merge.count()) await merge.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  return cdp;
}

test.beforeEach(async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `regression-${crypto.randomUUID()}` });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

for (const kind of ['own 120 words', 'Heidelberg Q1']) {
  test(`P0-1 ${kind}: every current word stays above the keyboard`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (kind === 'own 120 words') {
      await own(page, 'Long own text', Array.from({ length: 120 }, (_, i) => ['Grace', 'peace', 'hope', 'love'][i % 4]).join(' '));
      await openOwn(page, 'Long own text');
      await expect(page.locator('[data-word]')).toHaveCount(120);
    } else {
      await tab(page, 'Discover');
      await page.getByRole('button', { name: 'Catechisms', exact: true }).click();
      await page.getByRole('combobox', { name: 'Browse', exact: true }).selectOption({ label: 'Heidelberg Catechism' });
      await page.getByRole('button', { name: 'Add Q1', exact: true }).click();
      await tab(page, 'Today');
      await page.getByRole('button', { name: 'Begin', exact: true }).click();
      expect(await page.locator('[data-word]').count()).toBeGreaterThan(100);
    }
    await type(page, true);
    expect(await page.locator('.verse').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(page.viewportSize()!.height);
  });
}

test('P1-1/2 closing a shortcut changes nothing; closing a result retains the completed attempt', async ({ page }) => {
  await own(page, 'Close regression');
  await openOwn(page, 'Close regression');
  const before = await state(page);
  await page.getByRole('button', { name: 'I know this', exact: true }).click();
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await account(page);
  await page.getByLabel('Display name').fill('Different name');
  await page.getByLabel('Display name').press('Tab');
  await page.reload();
  expect((await state(page)).items).toEqual(before.items);
  await openOwn(page, 'Close regression');
  await type(page);
  await expect.poll(async () => (await state(page)).items[0].step).toBe(2);
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await page.reload();
  const after = await state(page);
  expect(after.items[0].step).toBe(2);
  expect(after.events).toHaveLength(1);
});

test('P1-3/4 completed rehearsal leaves the learned item, review schedule and history unchanged', async ({ page }) => {
  await own(page, 'Rehearsal regression');
  await openOwn(page, 'Rehearsal regression');
  await page.getByRole('button', { name: 'I know this', exact: true }).click();
  await type(page);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Learned', exact: true })).toBeVisible();
  const before = await state(page);
  expect(Date.parse(before.items[0].due)).toBeGreaterThan(Date.now() + 23 * 3600000);
  await page.getByRole('button', { name: 'Practice once more', exact: true }).click();
  await expect(page.locator('[data-hidden="true"]')).toHaveCount(await page.locator('[data-word]').count());
  await type(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  const after = await state(page);
  expect(after.items).toEqual(before.items);
  expect(after.events).toEqual(before.events);
});

test('P1-5 default daily cap is three, configurable and persistent; extra items can start early', async ({ page }) => {
  for (let i = 1; i <= 5; i++) await own(page, `Daily text ${i}`);
  await tab(page, 'Today');
  await expect(page.getByText('3 to practice', { exact: true })).toBeVisible();
  await tab(page, 'Library');
  await page.getByRole('button', { name: /^My texts/ }).click();
  await expect(page.getByRole('button', { name: 'Start early', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Start early', exact: true }).first().click();
  await expect(page.locator('[data-word]')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await tab(page, 'Today');
  await account(page);
  await expect(page.getByLabel('New per day')).toHaveValue('3');
  await page.getByLabel('New per day').selectOption('1');
  await page.reload();
  await expect(page.getByText('1 to practice', { exact: true })).toBeVisible();
  await account(page);
  await expect(page.getByLabel('New per day')).toHaveValue('1');
});

test('P1-7 wrong visible initial has amber slip feedback without scoring a hidden-word slip', async ({ page }) => {
  await own(page, 'Visible feedback');
  await openOwn(page, 'Visible feedback');
  await page.keyboard.press('z');
  await expect(page.locator('[data-word="0"]')).toHaveClass(/slip/);
  await expect(page.locator('[data-word="0"]')).toHaveClass(/done/);
  const feedback = await page.locator('[data-word="0"]').evaluate(el => {
    const css = getComputedStyle(el); return { color: css.color, animation: css.animationName };
  });
  expect(feedback.animation).not.toBe('none');
  expect(feedback.color).not.toBe('rgb(0, 0, 0)');
});

for (const mode of ['passage', 'separate', 'chunks', 'large batch']) {
  test(`P1-10 range addition: ${mode}`, async ({ page }) => {
    await tab(page, 'Discover');
    await page.getByLabel('Bible reference').fill(mode === 'passage' || mode === 'separate' ? 'Romans 8:28-30' : 'Psalm 119:1-24');
    await page.getByRole('button', { name: 'Find verses', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add to library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', {name:'Separate verses',exact:true})).toHaveAttribute('aria-pressed','false');
    if (mode === 'separate' || mode === 'large batch') await page.getByRole('button',{name:'Separate verses',exact:true}).click();
    if (mode === 'chunks') await page.getByRole('button',{name:'Chunks of ~4 verses',exact:true}).click();
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    if (mode === 'large batch') {
      await expect(page.getByRole('dialog', { name: 'Add 24 items?' })).toBeVisible();
      expect((await state(page)).items).toHaveLength(0);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Add to library', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Add items', exact: true }).click();
    }
    const count = { passage: 1, separate: 3, chunks: 6, 'large batch': 24 }[mode]!;
    if(mode==='passage')expect((await state(page)).items[0].title).toBe('Romans 8:28–30');
    if(mode==='chunks')expect((await state(page)).items[0].title).toBe('Psalm 119:1–4');
    await expect.poll(async () => (await state(page)).items.filter((i: any) => !i.deleted).length).toBe(count);
    await tab(page, 'Library');
    await expect(page.getByRole('button', { name: /^My verses/ })).toHaveCount(1);
  });
}

test('P0-3 cached account survives offline reload, queues practice and syncs on reconnect without reload', async ({ page, context }) => {
  await account(page);
  const cdp = await signup(page);
  await own(page, 'Offline account text');
  await expect.poll(async () => JSON.stringify(await (await page.request.get('/api/export')).json())).toContain('Offline account text');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })); });
  await context.setOffline(true);
  await page.reload();
  await account(page);
  await expect(page.getByRole('button', { name: 'Create account with a passkey', exact: true })).toHaveCount(0);
  await expect(page.getByText('Offline · changes will sync', { exact: true })).toBeVisible();
  await openOwn(page, 'Offline account text');
  await type(page);
  await expect.poll(async () => (await state(page)).queue.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close practice', exact: true }).click();
  await context.setOffline(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(async () => {
    const exported = await (await page.request.get('/api/export')).json();
    return exported.items.find((i: any) => i.title === 'Offline account text')?.step;
  }).toBe(2);
  await expect.poll(async () => (await state(page)).queue.length).toBe(0);
  await cdp.detach();
});

for (const choice of ['Add', 'Keep separate']) {
  test(`P1-19 sign-out clears device data; sign-in local ownership: ${choice}`, async ({ page }) => {
    await account(page);
    const cdp = await signup(page);
    await own(page, 'Account-only text');
    await expect.poll(async () => JSON.stringify(await (await page.request.get('/api/export')).json())).toContain('Account-only text');
    await tab(page, 'Today');
    await account(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const signout = page.getByRole('dialog', { name: 'Sign out on this device?' });
    await expect(signout).toContainText('Your practice is saved to your account');
    await signout.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await state(page)).items.some((i: any) => i.title === 'Account-only text')).toBe(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toBeVisible();
    expect((await state(page)).items).toHaveLength(0);
    expect((await state(page)).events).toHaveLength(0);
    await own(page, 'Unclaimed device text');
    await tab(page, 'Today');
    await account(page);
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    const merge = page.getByRole('dialog').filter({ hasText: /items? on this device/ });
    await expect(merge).toBeVisible();
    expect(JSON.stringify(await (await page.request.get('/api/export')).json())).not.toContain('Unclaimed device text');
    await merge.getByRole('button', { name: choice, exact: true }).click();
    if (choice === 'Keep separate') {
      const discard = page.getByRole('dialog', { name: 'Discard this device’s local items?' });
      await expect(discard).toContainText(/discard|remove|delete/i);
      // The second explicit destructive choice is required before local data disappears.
      expect((await state(page)).items.some((i: any) => i.title === 'Unclaimed device text')).toBe(true);
      await discard.getByRole('button', { name: 'Discard local items', exact: true }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => {
      const exported = await (await page.request.get('/api/export')).json();
      return exported.items.some((i: any) => i.title === 'Unclaimed device text' && !i.deleted);
    }).toBe(choice === 'Add');
    await expect.poll(async () => (await state(page)).items.some((i: any) => i.title === 'Account-only text' && !i.deleted)).toBe(true);
    await cdp.detach();
  });
}

test('P1-15 uncached offline book explains how to download it', async ({ browser,baseURL }) => {
  // A blocked service worker makes the browser's offline emulation deterministic;
  // Chromium otherwise lets worker requests bypass context.setOffline.
  const context=await browser.newContext({serviceWorkers:'block',baseURL});const page=await context.newPage();
  try{await page.goto('/');await tab(page,'Discover');await page.getByLabel('Bible reference').fill('Isaiah 1:1');await context.setOffline(true);
  await page.getByRole('button',{name:'Find verses',exact:true}).click();await expect(page.getByRole('alert')).toHaveText("This book isn't saved on this device yet. Connect once to download it.");}finally{await context.close()}
});

test('P1-23 long absence without learned items never opens an empty welcome-back test', async ({ page }) => {
  await own(page, 'Still learning');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const value: any = await new Promise((resolve, reject) => { const r = db.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    value.settings.lastActive = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Still learning/ })).toBeVisible();
});

for (const [mistakes, title] of [[0, 'Solid'], [1, 'Remembered'], [3, 'Got there'], [10, "Let's relearn this"]] as const) {
  test(`P1-6 review ${title}: friendly title, next date and immediate save`, async ({ page }) => {
    await own(page, 'Review feedback', Array(20).fill('Grace').join(' '));
    await openOwn(page, 'Review feedback');
    await page.getByRole('button', { name: 'I know this', exact: true }).click();
    await type(page);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Today', exact: true }).click();
    await openOwn(page, 'Review feedback');
    for (let i = 0; i < 20; i++) await page.keyboard.press(i < mistakes ? 'z' : 'g');
    const result = page.getByRole('dialog', { name: title, exact: true });
    await expect(result).toBeVisible();
    await expect(result).toContainText(mistakes===10?'Starting again with a few words showing':/Back (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
    await expect(result).not.toContainText(/^(?:Again|Hard|Good|Easy)$/);
    await expect.poll(async () => (await state(page)).events.length).toBe(2);
    await result.getByRole('button', { name: mistakes===10?'Later':'Close practice', exact: true }).click();
    await page.reload();
    const saved = await state(page);
    expect(saved.items[0].learned).toBe(mistakes < 10);
    expect(saved.events).toHaveLength(2);
  });
}

test('P2-14/15 tab and detail history restores screens, closes sheets and protects the app root',async({page})=>{
 await tab(page,'Discover');
 await page.evaluate(()=>window.scrollTo(0,100));
 await tab(page,'Library');
 expect(await page.evaluate(()=>scrollY)).toBe(0);
 await page.goBack();
 await expect(page.getByRole('heading',{name:'Discover',exact:true})).toBeVisible();
 await tab(page,'Library');
 await page.locator('.covers button').filter({has:page.locator('b',{hasText:'Psalm 23'})}).click();
 await expect(page.getByRole('dialog',{name:'Psalm 23',exact:true})).toBeVisible();
 await page.goBack();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 for(let n=0;n<8;n++){await page.evaluate(()=>history.back());await page.waitForTimeout(60)}
 await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 expect(page.url()).not.toBe('about:blank');
});

for(const removed of [false,true])test(`P1-19 startup identity acquisition requires consent for ${removed?'removed-item history':'local items'}`,async({page})=>{
 await own(page,'Unclaimed private text');
 if(removed)await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('byheart',1);r.onsuccess=()=>resolve(r.result)});const state:any=await new Promise(resolve=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>resolve(r.result)});state.items[0].deleted=true;await new Promise<void>(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(state,'current');tx.oncomplete=()=>resolve()});db.close()});
 let uploads:any[]=[];
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'oauth-test-user',displayName:'Friend'}}}));
 await page.route('**/api/sync',async route=>{uploads.push(route.request().postDataJSON());await route.fulfill({json:{items:[],events:[]}})});
 await page.reload();
 const merge=page.getByRole('dialog').filter({hasText:/on this device to your account/});
 await expect(merge).toBeVisible();
 expect(uploads).toHaveLength(0);
 await merge.getByRole('button',{name:'Add',exact:true}).click();
 await expect.poll(()=>uploads.length).toBeGreaterThan(0);
 expect(JSON.stringify(uploads)).toContain('Unclaimed private text');
});

test('P2-15 button-dismissed preview consumes its history entry',async({page})=>{
 await tab(page,'Library');
 await page.locator('.covers button').filter({has:page.locator('b',{hasText:'Psalm 23'})}).click();
 await expect(page.getByRole('dialog',{name:'Psalm 23',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!history.state?.sheet)).toBe(false);
 await page.goBack();
 await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
});

test('P2-15 preview add replaces the sheet entry with collection detail',async({page})=>{
 await tab(page,'Library');
 await page.locator('.covers button').filter({has:page.locator('b',{hasText:'Psalm 23'})}).click();
 await page.getByRole('button',{name:'Add to my library',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Psalm 23',exact:true})).toBeVisible();
 await page.goBack();
 await expect(page.getByRole('heading',{name:'Library',exact:true})).toBeVisible();
 await page.goBack();
 await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
});

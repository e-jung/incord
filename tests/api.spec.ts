import { test, expect, type Page } from '@playwright/test';

const base = process.env.API_BASE_URL || 'http://localhost:8793';
async function api(page: Page, path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ path, data, method }) => {
    const response = await fetch('/api' + path, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }, { path, data, method });
}
async function emailLogin(page: Page, email: string) {
  expect((await api(page, '/auth/email/start', { email })).status).toBe(200);
  const code = (await api(page, '/test/last-code?email=' + encodeURIComponent(email))).data.code;
  const result = await api(page, '/auth/email/verify', { email, code });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data.recoveryCode).toBeUndefined();
  return result.data;
}

test.describe('Worker API (real local SQLite DOs and email sign-in)', () => {
  test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'api-'+crypto.randomUUID()})});
  test('auth rate limits isolate and throttle a single caller',async({page})=>{
    await page.goto(base);
    for(let n=0;n<60;n++)expect((await api(page,'/auth/logout',{})).status).toBe(200);
    expect((await api(page,'/auth/logout',{})).status).toBe(429);
  });
  test('origin protection, anonymous access and config', async ({ page, request }) => {
    await page.goto(base);
    const config = (await api(page, '/config')).data;
    expect(config).toMatchObject({ email: true }); expect(config).not.toHaveProperty('passkeys');
    expect((await api(page, '/me')).data.user).toBeNull();
    const bad = await request.post(base + '/api/auth/email/start', { data: {}, headers: { Origin: 'https://other.invalid' } });
    expect(bad.status()).toBe(403);
    const missing = await request.post(base + '/api/auth/email/start', { data: {} }); expect(missing.status()).toBe(403);
  });

  test('email sign-in, idempotent LWW sync, session revocation, export and deletion', async ({ page }) => {
    await page.goto(base);
    const email = 'api-' + crypto.randomUUID() + '@example.com';
    const registration = await emailLogin(page, email);
    expect(registration.user.hasEmail).toBe(true);
    expect(registration.user).not.toHaveProperty('hasPasskey');
    const now = Date.now();
    const item = { id: 'verse-1', title: 'John 3:16', text: 'For God so loved the world', due: new Date(now - 1000).toISOString(), step: 1, updatedAt: now };
    const event = { id: 'review-1', itemId: item.id, at: new Date(now).toISOString(), grade: 'Good' };
    const sync = await api(page, '/sync', { items: [item], events: [event], settings: { name: 'Kind friend', theme: 'dark', goal: 4, timeZone: 'America/Los_Angeles', pushEnabled: true, reminderTime: '19:00', updatedAt: now } });
    expect(sync.status).toBe(200); expect(sync.data.items).toEqual([item]); expect(sync.data.events).toEqual([event]); expect(sync.data.settings.timezone).toBe('America/Los_Angeles');
    expect((await api(page, '/me')).data.user.displayName).toBe('Kind friend');
    expect((await api(page, '/export')).data.user.displayName).toBe('Kind friend');
    expect((await api(page, '/sync', {settings:{timeZone:'Mars/Phobos',updatedAt:now}})).status).toBe(400);
    const fieldA=await api(page, '/sync',{settings:{name:'Grace',theme:'light',updatedAt:now+20,fieldUpdatedAt:{name:now+20,theme:now}}}); expect(fieldA.status).toBe(200);
    const fieldB=await api(page, '/sync',{settings:{name:'Kind friend',theme:'dark',updatedAt:now+30,fieldUpdatedAt:{name:now,theme:now+30}}}); expect(fieldB.data.settings).toMatchObject({name:'Grace',displayName:'Grace',theme:'dark'});
    expect((await api(page, '/export')).data.user.displayName).toBe('Grace');
    const repeated = await api(page, '/sync', { items: [{ ...item, title: 'Older edit', updatedAt: now - 100 }], events: [event] });
    expect(repeated.data.items[0].title).toBe(item.title); expect(repeated.data.events).toHaveLength(1);
    const tombstone = await api(page, '/sync', { items: [{ ...item, deleted: true, updatedAt: now + 10 }], events: [] }); expect(tombstone.data.items[0].deleted).toBe(true);
    const invalid = await api(page, '/sync', { items: [{ ...item, updatedAt: now + 86400000 }] }); expect(invalid.status).toBe(400);
    const exported = await api(page, '/export'); expect(exported.data.format).toBe('by-heart'); expect(exported.data.events).toHaveLength(1); expect(JSON.stringify(exported.data)).not.toContain('publicKey');
    const signedCookie = (await page.context().cookies()).find(c => c.name === 'bh_session')!; expect(signedCookie.httpOnly).toBe(true);
    await api(page, '/auth/logout', {}); expect((await api(page, '/me')).data.user).toBeNull();
    await emailLogin(page, email);
    const activeCookie = (await page.context().cookies()).find(c => c.name === 'bh_session')!;
    const oldContext = await page.context().browser()!.newContext(); await oldContext.addCookies([activeCookie]); const oldPage = await oldContext.newPage(); await oldPage.goto(base); expect((await api(oldPage, '/me')).data.user.displayName).toBe('Grace');
    expect((await api(page, '/auth/logout-everywhere', {})).status).toBe(200);
    expect((await api(oldPage, '/me')).data.user).toBeNull(); await oldContext.close();
    await emailLogin(page, email);
    expect((await api(page, '/account', undefined, 'DELETE')).status).toBe(200);
    expect((await api(page, '/me')).data.user).toBeNull();
    expect((await api(page, '/sync', {})).status).toBe(401);
  });

  test('retired passkey and recovery endpoints return 404 without creating a session', async ({ page }) => {
    await page.goto(base);
    for (const path of ['/auth/register/options', '/auth/register/verify', '/auth/login/options', '/auth/login/verify', '/auth/recover']) {
      expect((await api(page, path, { legacy: true, response: { id: 'old-key' }, code: 'old-code' })).status).toBe(404);
    }
    expect((await api(page, '/me')).data.user).toBeNull();
    expect((await page.context().cookies()).find(c => c.name === 'bh_flow')).toBeUndefined();
  });
});

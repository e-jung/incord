import { test, expect, type Page } from '@playwright/test';

const base = process.env.API_BASE_URL || 'http://localhost:8793';
async function api(page: Page, path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ path, data, method }) => {
    const response = await fetch('/api' + path, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }, { path, data, method });
}
async function authenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return client;
}
async function passkey(page: Page, kind: 'register' | 'login') {
  const options = await api(page, '/auth/' + kind + '/options', { displayName: 'API test' });
  expect(options.status).toBe(200);
  const response = await page.evaluate(async ({ options, kind }) => {
    const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const publicKey = { ...options, challenge: decode(options.challenge) };
    if (kind === 'register') { publicKey.user = { ...options.user, id: decode(options.user.id) }; publicKey.excludeCredentials = (options.excludeCredentials || []).map((c: any) => ({ ...c, id: decode(c.id) })); }
    else publicKey.allowCredentials = (options.allowCredentials || []).map((c: any) => ({ ...c, id: decode(c.id) }));
    const credential = (kind === 'register' ? await navigator.credentials.create({ publicKey }) : await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
    return (credential as any).toJSON();
  }, { options: options.data, kind });
  const result = await api(page, '/auth/' + kind + '/verify', { response });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}

test.describe('Worker API (real local SQLite DOs and virtual WebAuthn)', () => {
  test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'api-'+crypto.randomUUID()})});
  test('auth rate limits isolate and throttle a single caller',async({page})=>{
    await page.goto(base);
    for(let n=0;n<60;n++)expect((await api(page,'/auth/login/options',{})).status).toBe(200);
    expect((await api(page,'/auth/login/options',{})).status).toBe(429);
  });
  test('origin protection, anonymous access and config', async ({ page, request }) => {
    await page.goto(base);
    expect((await api(page, '/config')).data).toMatchObject({ passkeys: true });
    expect((await api(page, '/me')).status).toBe(401);
    const bad = await request.post(base + '/api/auth/login/options', { data: {}, headers: { Origin: 'https://other.invalid' } });
    expect(bad.status()).toBe(403);
    const missing = await request.post(base + '/api/auth/login/options', { data: {} }); expect(missing.status()).toBe(403);
  });

  test('passkeys, idempotent LWW sync, recovery rotation, export and deletion', async ({ page }) => {
    await page.goto(base); await authenticator(page);
    const registration = await passkey(page, 'register');
    expect(registration.recoveryCode).toBeTruthy();
    expect((await api(page, '/me')).data.user.displayName).toBe('API test');
    const now = Date.now();
    const item = { id: 'verse-1', title: 'John 3:16', text: 'For God so loved the world', due: new Date(now - 1000).toISOString(), step: 1, updatedAt: now };
    const event = { id: 'review-1', itemId: item.id, at: new Date(now).toISOString(), grade: 'Good' };
    const sync = await api(page, '/sync', { items: [item], events: [event], settings: { name: 'Kind friend', theme: 'dark', goal: 4, timeZone: 'America/Los_Angeles', pushEnabled: true, reminderTime: '19:00', updatedAt: now } });
    expect(sync.status).toBe(200); expect(sync.data.items).toEqual([item]); expect(sync.data.events).toEqual([event]); expect(sync.data.settings.timezone).toBe('America/Los_Angeles');
    const repeated = await api(page, '/sync', { items: [{ ...item, title: 'Older edit', updatedAt: now - 100 }], events: [event] });
    expect(repeated.data.items[0].title).toBe(item.title); expect(repeated.data.events).toHaveLength(1);
    const tombstone = await api(page, '/sync', { items: [{ ...item, deleted: true, updatedAt: now + 10 }], events: [] }); expect(tombstone.data.items[0].deleted).toBe(true);
    const invalid = await api(page, '/sync', { items: [{ ...item, updatedAt: now + 86400000 }] }); expect(invalid.status).toBe(400);
    const exported = await api(page, '/export'); expect(exported.data.format).toBe('by-heart'); expect(exported.data.events).toHaveLength(1); expect(JSON.stringify(exported.data)).not.toContain('publicKey');
    const signedCookie = (await page.context().cookies()).find(c => c.name === 'bh_session')!; expect(signedCookie.httpOnly).toBe(true);
    await api(page, '/auth/logout', {}); expect((await api(page, '/me')).status).toBe(401);
    await passkey(page, 'login');
    const recovered = await api(page, '/auth/recover', { code: registration.recoveryCode }); expect(recovered.status).toBe(200); expect(recovered.data.recoveryCode).not.toBe(registration.recoveryCode);
    expect((await api(page, '/auth/recover', { code: registration.recoveryCode })).status).toBe(401);
    const oldContext = await page.context().browser()!.newContext(); await oldContext.addCookies([signedCookie]); const oldPage = await oldContext.newPage(); await oldPage.goto(base); expect((await api(oldPage, '/me')).status).toBe(401); await oldContext.close();
    expect((await api(page, '/account', undefined, 'DELETE')).status).toBe(200);
    expect((await api(page, '/me')).status).toBe(401);
    expect((await api(page, '/auth/recover', { code: recovered.data.recoveryCode })).status).toBe(401);
  });

  test('one-use WebAuthn challenge rejects replay and malformed authenticator', async ({ page }) => {
    await page.goto(base); await authenticator(page); await passkey(page, 'register');
    await api(page, '/auth/logout', {});
    const options = await api(page, '/auth/login/options', {}); expect(options.status).toBe(200);
    const bad = await api(page, '/auth/login/verify', { response: { id: 'nonexistent' } }); expect(bad.status).toBe(401);
    const replay = await api(page, '/auth/login/verify', { response: { id: 'nonexistent' } }); expect(replay.status).toBe(400);
  });
});

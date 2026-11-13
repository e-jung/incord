import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  Client, StreamableHTTPClientTransport, discoverOAuthServerInfo,
  registerClient, startAuthorization, exchangeAuthorization,
} from '@modelcontextprotocol/client';

// Real local Worker + the official 2.4 SDK: no mocked MCP, OAuth, or sync endpoints.
const callback = 'http://localhost:19876/callback';
const toolNames = ['add_passages', 'get_due_today', 'get_progress', 'list_collections', 'list_library', 'lookup_passage', 'send_feedback'];

async function flow(baseURL: string, scope?: string) {
  const origin = new URL(baseURL).origin;
  const resource = origin + '/mcp';
  const info = await discoverOAuthServerInfo(resource, {
    resourceMetadataUrl: new URL(origin + '/.well-known/oauth-protected-resource/mcp'),
  });
  expect(info.resourceMetadata?.resource).toBe(resource);
  scope ??= info.resourceMetadata?.scopes_supported?.join(' ') || '';
  const clientName = 'Playwright MCP ' + crypto.randomUUID();
  const clientInformation = await registerClient(origin, {
    metadata: info.authorizationServerMetadata,
    clientMetadata: {
      client_name: clientName, redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, scope,
  });
  expect(clientInformation.token_endpoint_auth_method).toBe('none');
  const state = crypto.randomUUID();
  const authorization = await startAuthorization(origin, {
    metadata: info.authorizationServerMetadata, clientInformation, redirectUrl: callback, scope, state, resource,
  });
  expect(authorization.authorizationUrl.pathname).toBe('/oauth/authorize');
  expect(authorization.authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
  return { origin, resource, info, clientName, clientInformation, state, ...authorization };
}
type Flow = Awaited<ReturnType<typeof flow>>;

async function signIn(page: Page) {
  const email = `mcp-${crypto.randomUUID()}@example.com`;
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const response = await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email));
  expect(response.ok()).toBe(true);
  const { code } = await response.json();
  // Do not log codes or tokens; the test sink is available only in the local test Worker.
  await page.getByLabel('Six-digit code').fill(code);
}
async function settings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
}
async function decide(page: Page, f: Flow, decision: 'Approve connection' | 'Deny') {
  // Fulfill the loopback callback in-browser: no external navigation/listener required.
  await page.route(callback + '**', route => route.fulfill({ contentType: 'text/html', body: '<title>Returned to MCP client</title>' }));
  const returned = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.origin + url.pathname === callback;
  });
  await page.getByRole('button', { name: decision, exact: true }).click();
  const url = new URL((await returned).url());
  expect(url.searchParams.get('state')).toBe(f.state);
  await expect(page).toHaveTitle('Returned to MCP client');
  return url;
}
async function exchange(f: Flow, returned: URL) {
  const code = returned.searchParams.get('code');
  expect(Boolean(code)).toBe(true);
  return exchangeAuthorization(f.origin, {
    metadata: f.info.authorizationServerMetadata, clientInformation: f.clientInformation,
    authorizationCode: code!, iss: returned.searchParams.get('iss') ?? undefined,
    codeVerifier: f.codeVerifier, redirectUri: callback, resource: f.resource,
  });
}
async function connect(resource: string, token: string) {
  const client = new Client({ name: 'incord-playwright', version: '1.0.0' });
  const ip='mcp-sdk-'+crypto.randomUUID();
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
      authProvider: { token: async () => token },
      fetch:async(input,init)=>{const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));headers.set('CF-Connecting-IP',ip);return fetch(input,{...init,headers})},
    }));
    return client;
  } catch (error) { await client.close(); throw error; }
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find(block => block.type === 'text')?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text!);
}
async function tokenStatus(request: APIRequestContext, resource: string, token: string) {
  return (await request.post(resource, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })).status();
}
async function localState(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('state').objectStore('state').get('current');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  });
}
async function focusSync(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
async function approveSignedIn(page: Page, f: Flow) {
  await page.goto(f.authorizationUrl.href);
  await expect(page.getByRole('heading', { name: f.clientName, exact: true })).toBeVisible();
  return exchange(f, await decide(page, f, 'Approve connection'));
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': 'mcp-' + crypto.randomUUID() });
});

test('MCP discovery advertises OAuth and refuses anonymous access', async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const denied = await request.post('/mcp', {
    headers: { Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(denied.status()).toBe(401);
  expect(denied.headers()['www-authenticate']).toContain('/.well-known/oauth-protected-resource/mcp');
  const metadata = await request.get('/.well-known/oauth-authorization-server');
  expect(metadata.ok()).toBe(true);
  expect(await metadata.json()).toMatchObject({
    issuer: origin, authorization_endpoint: origin + '/oauth/authorize',
    token_endpoint: origin + '/oauth/token', registration_endpoint: origin + '/oauth/register',
    code_challenge_methods_supported: expect.arrayContaining(['S256']),
  });
  const resource = await request.get('/.well-known/oauth-protected-resource/mcp');
  expect(resource.ok()).toBe(true);
  expect(await resource.json()).toMatchObject({ resource: origin + '/mcp', authorization_servers: [origin], scopes_supported: ['library:read','library:write'] });
});

test('DCR → signed-out email → consent → SDK tools → offline reconciliation → Settings disconnect', async ({ page, context, baseURL }) => {
  const f = await flow(baseURL!);
  await page.goto(f.authorizationUrl.href);
  await expect(page.getByRole('heading', { name: 'Sign in to connect an app', exact: true })).toBeVisible();
  await signIn(page);
  await expect(page.getByRole('heading', { name: f.clientName, exact: true })).toBeVisible();
  await expect(page.getByText('See your library and progress', { exact: true })).toBeVisible();
  await expect(page.getByText('Add passages to your library', { exact: true })).toBeVisible();
  const returned=await decide(page,f,'Approve connection');
  const tokens=await exchange(f,returned);
  const client = await connect(f.resource, tokens.access_token);
  try {
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(toolNames);
    const lookup = await call(client, 'lookup_passage', { reference: 'John 3:16', translation: 'BSB' });
    expect(lookup.count).toBe(1);
    expect((await call(client, 'list_collections')).passages.itemCount).toBe(17);
    expect(await call(client, 'get_progress')).toMatchObject({ total: 0 });
    expect(await call(client, 'get_due_today')).toMatchObject({ count: 0 });
    await call(client, 'add_passages', { items: [{ reference: 'John 3:16', translation: 'BSB' }] });
    expect((await call(client, 'list_library')).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bsb-jhn-3-16', origin: 'mcp' }),
    ]));
    await page.goto('/');
    await expect.poll(async () => (await localState(page))?.items.find((i: any) => i.id === 'bsb-jhn-3-16')?.origin).toBe('mcp');
    await page.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: /^My verses/ }).click();
    await expect(page.getByText('John 3:16', { exact: true }).first()).toBeVisible();

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    await context.setOffline(true);
    // Model a real persisted, queued local practice edit. Reload offline so the
    // live Svelte store owns this revision before a concurrent MCP addition.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('byheart', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
      const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      const r = store.get('current');
      r.onsuccess = () => {
        const state = r.result, item = state.items.find((i: any) => i.id === 'bsb-jhn-3-16');
        item.step = 3; item.updatedAt = Math.max(Date.now(), item.updatedAt + 1);
        const event = { id: crypto.randomUUID(), itemId: item.id, at: new Date().toISOString(), slips: 0, hidden: 4, grade: 'good', mode: 'learn', step: 2 };
        state.events.push(event); state.queue.push(event.id); store.put(state, 'current');
      };
      await done; db.close();
    });
    await page.reload();
    await expect.poll(async () => (await localState(page))?.queue.length).toBeGreaterThan(0);
    // SDK traffic runs in Node, independently of the browser's offline state.
    await call(client, 'add_passages', { items: [{ reference: 'John 3:16' }, { reference: 'John 3:17' }] });
    await context.setOffline(false);
    await focusSync(page);
    await expect.poll(async () => (await localState(page))?.queue.length).toBe(0);
    await expect.poll(async () => {
      const state = await localState(page);
      return { step: state.items.find((i: any) => i.id === 'bsb-jhn-3-16')?.step, added: state.items.some((i: any) => i.id === 'bsb-jhn-3-17' && i.origin === 'mcp') };
    }).toEqual({ step: 3, added: true });
    const exported = await (await page.request.get('/api/export')).json();
    expect(exported.items.find((i: any) => i.id === 'bsb-jhn-3-16').step).toBe(3);
    expect(exported.events.some((e: any) => e.itemId === 'bsb-jhn-3-16' && e.step === 2)).toBe(true);
    expect((await call(client, 'list_library')).items.find((i: any) => i.id === 'bsb-jhn-3-16').step).toBe(3);

    await settings(page);
    await expect(page.getByRole('heading', { name: 'Connected apps', exact: true })).toBeVisible();
    const app = page.locator('.mcp-app').filter({ has: page.getByRole('heading', { name: f.clientName, exact: true }) });
    await expect(app).toBeVisible();
    await app.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(app).toHaveCount(0);
    expect(await tokenStatus(page.request, f.resource, tokens.access_token)).toBe(401);
    expect((await (await page.request.get('/api/oauth/apps')).json()).apps).toHaveLength(0);
    expect((await (await page.request.get('/api/export')).json()).items.some((i: any) => i.id === 'bsb-jhn-3-17')).toBe(true);
  } finally { await context.setOffline(false); await client.close(); }
});

test('read-only approval allows SDK reads but rejects writes with HTTP 403', async ({ page, baseURL }) => {
  await settings(page); await signIn(page);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  const f = await flow(baseURL!, 'library:read');
  await page.goto(f.authorizationUrl.href);
  await expect(page.getByRole('button', { name: 'Approve connection', exact: true })).toBeVisible();
  await expect(page.getByText('Add passages to your library', { exact: true })).toHaveCount(0);
  const approvedRedirect=await decide(page,f,'Approve connection');
  const tokens=await exchange(f,approvedRedirect);
  const client = await connect(f.resource, tokens.access_token);
  try {
    expect(await call(client, 'list_library')).toMatchObject({ total: 0 });
    // Feedback is available even to read-only clients and cannot read the library.
    const message='Please add a dark-mode schedule '+crypto.randomUUID();
    expect(await call(client,'send_feedback',{kind:'Idea',message,contact:'reply@example.com'})).toMatchObject({ok:true,message:'Thanks — Eric reads every one.'});
    const invalid=await client.callTool({name:'send_feedback',arguments:{kind:'Idea',message:'short'}});expect(invalid.isError).toBe(true);
    const stats=await page.context().newPage();
    try{await stats.goto('/stats');await stats.getByLabel('Stats token').fill('incord-playwright-local-stats-token-32chars');await stats.getByRole('button',{name:'View counts',exact:true}).click();const feedback=stats.getByRole('region',{name:'Feedback',exact:true});await expect(feedback).toContainText(message);await expect(feedback).toContainText(f.clientName);await expect(feedback).toContainText('mcp');await expect(feedback).toContainText('reply@example.com');}finally{await stats.close()}
    // Keep the SDK on the wire for the denied call and inspect its HTTP result.
    let writeStatus = 0, writeChallenge = '';
    const restricted = new Client({ name: 'incord-readonly-test', version: '1.0.0' });
    try {
      await restricted.connect(new StreamableHTTPClientTransport(new URL(f.resource), {
        authProvider: { token: async () => tokens.access_token },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (response.status === 403) {writeStatus = response.status;writeChallenge=response.headers.get('WWW-Authenticate')||'';}
          return response;
        },
      }));
      await expect(restricted.callTool({ name: 'add_passages', arguments: { items: [{ reference: 'John 3:16' }] } })).rejects.toThrow();
      expect(writeStatus).toBe(403);
      expect(writeChallenge).toContain('library:read library:write');
      expect(await call(client, 'list_library')).toMatchObject({ total: 0 });
    } finally { await restricted.close(); }
    const batch=await page.request.post(f.resource,{headers:{Authorization:'Bearer '+tokens.access_token,Accept:'application/json, text/event-stream'},data:[{jsonrpc:'2.0',id:20,method:'tools/call',params:{name:'add_passages',arguments:{items:['John 3:16']}}},{jsonrpc:'2.0',id:21,method:'tools/call',params:{name:'list_library',arguments:{}}}]});
    expect(batch.status()).toBe(400);expect(await batch.json()).toMatchObject({error:{code:-32600}});
    expect(await call(client,'list_library')).toMatchObject({total:0});
    // Replaying a consumed code revokes the grant's tokens, as the provider specifies.
    await expect(exchange(f,approvedRedirect)).rejects.toThrow();
    expect(await tokenStatus(page.request,f.resource,tokens.access_token)).toBe(401);
  } finally { await client.close(); }
});

test('consent rejects cross-origin and missing-cookie decisions; UI Deny creates no grant', async ({ page, playwright, baseURL }) => {
  await settings(page); await signIn(page);
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  const f = await flow(baseURL!);
  const response = await page.request.get('/api/oauth/consent' + f.authorizationUrl.search);
  expect(response.ok()).toBe(true);
  const { handle } = await response.json();
  const crossOrigin = await page.request.post('/api/oauth/consent', {
    headers: { Origin: 'https://unrelated.example' }, data: { handle, decision: 'approve', statsEnabled: false },
  });
  expect(crossOrigin.status()).toBe(403);
  // Keep the signed-in session but remove the separate consent-binding cookie.
  const storage = await page.context().storageState();
  const isolated = await playwright.request.newContext({
    baseURL, storageState: { ...storage, cookies: storage.cookies.filter(cookie => cookie.name === 'bh_session') },
  });
  try {
    const missingCookie = await isolated.post('/api/oauth/consent', {
      headers: { Origin: f.origin }, data: { handle, decision: 'approve', statsEnabled: false },
    });
    expect(missingCookie.status()).toBe(400);
  } finally { await isolated.dispose(); }
  await page.goto(f.authorizationUrl.href);
  await expect(page.getByRole('heading', { name: f.clientName, exact: true })).toBeVisible();
  const returned = await decide(page, f, 'Deny');
  expect(returned.searchParams.get('error')).toBe('access_denied');
  expect(returned.searchParams.has('code')).toBe(false);
  expect((await (await page.request.get('/api/oauth/apps')).json()).apps).toHaveLength(0);
});

for (const action of ['logout-everywhere', 'delete-account'] as const) {
  test(`${action} invalidates an already-issued MCP bearer`, async ({ page, baseURL }) => {
    await settings(page); await signIn(page);
    await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
    const f = await flow(baseURL!);
    const tokens = await approveSignedIn(page, f);
    const client = await connect(f.resource, tokens.access_token);
    try {
      expect((await client.listTools()).tools).toHaveLength(7);
      const response = action === 'logout-everywhere'
        ? await page.request.post('/api/auth/logout-everywhere', { headers: { Origin: f.origin }, data: {} })
        : await page.request.delete('/api/account', { headers: { Origin: f.origin } });
      expect(response.ok()).toBe(true);
      expect(await tokenStatus(page.request, f.resource, tokens.access_token)).toBe(401);
    } finally { await client.close(); }
  });
}

test('MCP request limits apply per bearer and across a user’s connections',async({page,baseURL})=>{
  await settings(page);await signIn(page);await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
  const first=await flow(baseURL!),tokens=await approveSignedIn(page,first);
  let status=0;
  const create=async(resource:string,token:string)=>{const client=new Client({name:'rate-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{authProvider:{token:async()=>token},fetch:async(input,init)=>{const response=await fetch(input,init);status=response.status;return response}}));return client;};
  const client=await create(first.resource,tokens.access_token);
  try{for(let n=0;n<35;n++){try{await client.listTools()}catch{break}}expect(status).toBe(429);}finally{await client.close()}
  // A second token is not exhausted yet, but shares the account's 60/min budget.
  const second=await flow(baseURL!),secondTokens=await approveSignedIn(page,second);
  const next=await create(second.resource,secondTokens.access_token);
  try{expect((await next.listTools()).tools).toHaveLength(7);for(let n=0;n<35;n++){try{await next.listTools()}catch{break}}expect(status).toBe(429);}finally{await next.close()}
});

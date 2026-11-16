import { describe, it, expect, vi, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqliteOAuthKV, OAuthStorageDO } from '../cloudflare/oauth-storage';
import { UserDO, type Env } from '../cloudflare/worker';
function state() {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    id: { toString: () => 'unit-user' },
    storage: {
      sql: {
        exec(q: string, ...args: any[]) {
          const stmt = db.prepare(q);
          return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []);
        },
      },
      transactionSync(fn: () => any) {
        const name = 'tx' + depth++;
        db.exec('SAVEPOINT ' + name);
        try {
          const result = fn();
          db.exec('RELEASE ' + name);
          return result;
        } catch (e) {
          db.exec('ROLLBACK TO ' + name);
          db.exec('RELEASE ' + name);
          throw e;
        } finally {
          depth--;
        }
      },
    },
    blockConcurrencyWhile: (fn: () => any) => fn(),
  } as unknown as DurableObjectState;
}
afterEach(() => vi.restoreAllMocks());
describe('SQLite OAuth storage', () => {
  it('supports JSON/text reads, metadata, ordered prefix pages and deletions', async () => {
    const kv = new SqliteOAuthKV(state().storage.sql);
    await kv.put('grant:a', '{"x":1}', { metadata: { client: 'one' } });
    await kv.put('grant:b', 'two');
    await kv.put('other', 'three');
    expect(await kv.get('grant:a', { type: 'json' })).toEqual({ x: 1 });
    expect(await kv.get('grant:b')).toBe('two');
    const first = await kv.list({ prefix: 'grant:', limit: 1 });
    expect(first.keys).toEqual([{ name: 'grant:a', metadata: { client: 'one' } }]);
    expect(first.list_complete).toBe(false);
    const second = await kv.list({ prefix: 'grant:', cursor: first.cursor, limit: 1 });
    expect(second.keys).toEqual([{ name: 'grant:b' }]);
    expect(second.list_complete).toBe(true);
    await kv.delete('grant:b');
    expect(await kv.get('grant:b')).toBeNull();
  });
  it('expires records at TTL without a background cleanup job', async () => {
    const kv = new SqliteOAuthKV(state().storage.sql),
      now = Date.now();
    await kv.put('code', 'secret', { expirationTtl: 60 });
    vi.spyOn(Date, 'now').mockReturnValue(now + 61000);
    expect(await kv.get('code')).toBeNull();
    expect((await kv.list()).keys).toEqual([]);
  });
  it('binds consent to the account and session version that saw the consent screen', async () => {
    const object = new OAuthStorageDO(state()),
      origin = 'http://localhost:8793';
    const rpc = (path: string, data: any) =>
      object.fetch(
        new Request('https://internal' + path, {
          method: 'POST',
          body: JSON.stringify({ origin, ...data }),
        }),
      );
    const register = await rpc('/http', {
      url: origin + '/oauth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test',
        redirect_uris: ['http://localhost:19876/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    });
    const client = await register.json<any>();
    expect(register.ok).toBe(true);
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'http://localhost:19876/callback',
      response_type: 'code',
      scope: 'library:read',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
      resource: origin + '/mcp',
    });
    const response = await rpc('/consent', {
      url: origin + '/oauth/authorize?' + params,
      uid: 'first-account',
      version: 1,
    });
    expect(response.ok).toBe(true);
    const { handle } = await response.json<any>();
    for (const actor of [
      { uid: 'other-account', version: 1 },
      { uid: 'first-account', version: 2 },
    ])
      expect(
        (
          await rpc('/decision', {
            url: origin + '/oauth/authorize',
            method: 'POST',
            handle,
            decision: 'approve',
            ...actor,
          })
        ).status,
      ).toBe(400);
  });
  it('defaults omitted scopes to read and add and disables external client metadata fetches', async () => {
    const object = new OAuthStorageDO(state()),
      origin = 'http://localhost:8793';
    const rpc = (path: string, data: any) =>
      object.fetch(
        new Request('https://internal' + path, {
          method: 'POST',
          body: JSON.stringify({ origin, ...data }),
        }),
      );
    const r = await rpc('/http', {
      url: origin + '/oauth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'No scopes',
        redirect_uris: ['http://localhost:19876/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    });
    const client = await r.json<any>();
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'http://localhost:19876/callback',
      response_type: 'code',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
    const consent = await rpc('/consent', {
      url: origin + '/oauth/authorize?' + params,
      uid: 'one',
      version: 1,
    });
    expect(consent.ok).toBe(true);
    expect((await consent.json<any>()).scope).toEqual(['library:read', 'library:write']);
    const fetch = vi.spyOn(globalThis, 'fetch');
    params.set('client_id', 'https://slow.example/client.json');
    expect(
      (
        await rpc('/consent', {
          url: origin + '/oauth/authorize?' + params,
          uid: 'one',
          version: 1,
        })
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('contains unexpected provider failures without resetting the shared object', async () => {
    const object = new OAuthStorageDO(state());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    (object as any).kv.list = async () => {
      throw Error('temporary storage failure');
    };
    const response = await object.fetch(
      new Request('https://internal/apps', {
        method: 'POST',
        body: JSON.stringify({ origin: 'http://localhost:8793', uid: 'one' }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'temporarily_unavailable' });
  });
  it('serves RFC8414 discovery with DCR and S256 without a KV binding', async () => {
    const object = new OAuthStorageDO(state());
    const r = await object.fetch(
      new Request('https://internal/http', {
        method: 'POST',
        body: JSON.stringify({
          origin: 'http://localhost:8793',
          url: 'http://localhost:8793/.well-known/oauth-authorization-server',
        }),
      }),
    );
    expect(r.ok).toBe(true);
    expect(await r.json()).toMatchObject({
      issuer: 'http://localhost:8793',
      registration_endpoint: 'http://localhost:8793/oauth/register',
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['library:read', 'library:write'],
    });
  });
});
describe('MCP uses the device sync data path', () => {
  function fixture() {
    const user = new UserDO(state(), {} as Env);
    const call = async (path: string, data: any = {}) => {
      const r = await user.fetch(
        new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }),
      );
      return { status: r.status, data: await r.json<any>() };
    };
    return { call };
  }
  const item = (id: string, extra: any = {}) => ({
    id,
    title: 'John 3:16',
    text: 'Public-domain text',
    collection: 'bible',
    translation: 'BSB',
    ...extra,
  });
  it('returns MCP adds on next device sync, never overwrites a live edit, and deduplicates', async () => {
    const f = fixture();
    await f.call('/init');
    expect((await f.call('/mcp/add', { items: [item('bsb-jhn-3-16')] })).data.results).toEqual([
      { id: 'bsb-jhn-3-16', status: 'added' },
    ]);
    let sync = (await f.call('/sync', { items: [], events: [] })).data;
    expect(sync.items).toHaveLength(1);
    const added = sync.items[0];
    expect(added).toMatchObject({ origin: 'mcp', step: 1, learned: false });
    const edited = { ...added, title: 'My local title', step: 3, updatedAt: added.updatedAt + 1 };
    await f.call('/sync', { items: [edited] });
    expect(
      (await f.call('/mcp/add', { items: [item('bsb-jhn-3-16'), item('bsb-jhn-3-17')] })).data
        .results[0].status,
    ).toBe('already in library');
    sync = (await f.call('/sync', { items: [added] })).data;
    expect(sync.items).toHaveLength(2);
    expect(sync.items.find((i: any) => i.id === added.id)).toEqual(edited);
  });
  it('preserves an unsynced device copy practiced before the MCP insertion', async () => {
    const f = fixture();
    await f.call('/init');
    const local = item('bsb-jhn-3-16', {
      title: 'My offline title',
      step: 3,
      learned: false,
      updatedAt: Date.now() - 10000,
    });
    await f.call('/mcp/add', { items: [item(local.id)] });
    const sync = (
      await f.call('/sync', {
        items: [local],
        events: [{ id: 'offline-event', itemId: local.id, at: new Date().toISOString(), step: 2 }],
      })
    ).data;
    expect(sync.items).toEqual([local]);
    expect(sync.events).toHaveLength(1);
  });
  it('reads only MCP data and skips the review log for library-only tools', async () => {
    const f = fixture();
    await f.call('/init');
    await f.call('/sync', {
      items: [item('bsb-jhn-3-16', { updatedAt: 1 })],
      events: [
        {
          id: 'event',
          itemId: 'bsb-jhn-3-16',
          at: '2026-11-13T12:00:00Z',
          mode: 'learn',
          text: 'Private event detail',
        },
      ],
    });
    expect((await f.call('/mcp/state')).data).toMatchObject({
      events: [],
      items: [{ id: 'bsb-jhn-3-16' }],
    });
    const result = (await f.call('/mcp/state', { events: true })).data;
    expect(result.user).toBeUndefined();
    expect(result.events).toEqual([
      { itemId: 'bsb-jhn-3-16', at: '2026-11-13T12:00:00Z', mode: 'learn' },
    ]);
  });
  it('keeps a later account privacy opt-out and rejects stale MCP session writes', async () => {
    const f = fixture();
    await f.call('/init');
    expect((await f.call('/me')).data.mcpCountsEnabled).toBe(true);
    await f.call('/mcp/privacy', { enabled: false });
    expect((await f.call('/me')).data.mcpCountsEnabled).toBe(false);
    await f.call('/revoke');
    expect((await f.call('/mcp/add', { version: 1, items: [item('bsb-jhn-3-16')] })).status).toBe(
      401,
    );
    expect((await f.call('/export')).data.items).toHaveLength(0);
  });
  it('revives tombstones with a strictly newer revision through the shared merge', async () => {
    const f = fixture();
    await f.call('/init');
    const old = item('bsb-jhn-3-16', { deleted: true, updatedAt: Date.now() + 1000 });
    await f.call('/sync', { items: [old] });
    await f.call('/mcp/add', { items: [item(old.id)] });
    const live = (await f.call('/sync')).data.items[0];
    expect(live.deleted).toBe(false);
    expect(live.updatedAt).toBe(old.updatedAt + 1);
    expect(live.origin).toBe('mcp');
  });
  it('strips ESV text and enforces the same publisher limits on MCP writes', async () => {
    const f = fixture();
    await f.call('/init');
    const esv = item('esv-jhn-3-16', {
      translation: 'ESV',
      reference: 'John 3:16',
      esvVerseKeys: ['jhn-3-16'],
      text: 'Never stored',
    });
    expect((await f.call('/mcp/add', { items: [esv] })).data.results[0].status).toBe('added');
    expect((await f.call('/export')).data.items[0].text).toBe('');
    const invalid = item('esv-jud-1-1--esv-jud-1-20', {
      translation: 'ESV',
      reference: 'Jude 1:1-20',
      esvVerseKeys: Array.from({ length: 20 }, (_, i) => 'jud-1-' + (i + 1)),
    });
    const result = await f.call('/mcp/add', { items: [invalid] });
    expect(result.data.results[0].status).toBe('invalid reference');
    expect((await f.call('/export')).data.items).toHaveLength(1);
  });
});

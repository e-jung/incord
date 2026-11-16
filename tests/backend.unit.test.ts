import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  b64,
  unb64,
  signSession,
  readSession,
  localDay,
  timestamp,
  validateSubscription,
  sendWebPush,
  type Env,
} from '../cloudflare/worker';
const enc = new TextEncoder();
const bytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  );
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Backend security and interoperable Web Push', () => {
  it('round-trips base64url without padding', () => {
    const value = crypto.getRandomValues(new Uint8Array(100));
    expect(unb64(b64(value))).toEqual(value);
  });
  it('rejects forged, expired and malformed HMAC sessions', async () => {
    const secret = 'test-only-secret-that-is-over-32-characters';
    const session = {
      uid: '11111111-1111-4111-8111-111111111111',
      version: 2,
      exp: Date.now() / 1000 + 1000,
    };
    const token = await signSession(session, secret);
    expect(await readSession(token, secret)).toEqual(session);
    expect(await readSession(token, 'different-key')).toBeNull();
    expect(await readSession('bad.token', secret)).toBeNull();
    expect(await readSession(await signSession({ ...session, exp: 1 }, secret), secret)).toBeNull();
  });
  it('computes local dates across UTC boundaries and DST', () => {
    expect(localDay(new Date('2026-11-01T06:30:00Z'), 'America/Los_Angeles')).toBe('2026-10-31');
    expect(localDay(new Date('2026-11-01T09:30:00Z'), 'America/Los_Angeles')).toBe('2026-11-01');
    expect(localDay(new Date('2026-01-01T20:00:00Z'), 'Asia/Tokyo')).toBe('2026-01-02');
  });
  it('validates timestamps and rejects invalid future writes', () => {
    const now = Date.now();
    expect(timestamp(now)).toBe(now);
    expect(timestamp(new Date(now).toISOString())).toBe(now);
    for (const value of [NaN, -1, 'nonsense', now + 86400000, undefined])
      expect(() => timestamp(value)).toThrow();
  });
  it('prevents push endpoint SSRF and malformed key material', () => {
    const keys = { p256dh: b64(new Uint8Array(65)), auth: b64(new Uint8Array(16)) };
    for (const endpoint of [
      'http://fcm.googleapis.com/a',
      'https://127.0.0.1/a',
      'https://fcm.googleapis.com.evil.test/a',
      'https://fcm.googleapis.com:8443/a',
      'https://user:password@fcm.googleapis.com/a',
    ])
      expect(() => validateSubscription({ endpoint, keys })).toThrow();
    expect(() =>
      validateSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys }),
    ).not.toThrow();
  });
  it.each([
    'https://fcm.googleapis.com/fcm/send/test',
    'https://web.push.apple.com/device/private-token',
  ])(
    'encrypts interoperable push and signs a 30-minute origin-scoped JWT for %s',
    async (endpoint) => {
      const receiver = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );
      const receiverPublic = new Uint8Array(
        await crypto.subtle.exportKey('raw', receiver.publicKey),
      );
      const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
      ]);
      const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey));
      const privateJwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
      const auth = crypto.getRandomValues(new Uint8Array(16));
      const env = {
        VAPID_PUBLIC_KEY: b64(publicRaw),
        VAPID_PRIVATE_KEY: privateJwk.d!,
        VAPID_SUBJECT: 'mailto:test@example.com',
      } as Env;
      const payload = { title: 'By Heart', body: 'A gentle moment', url: '/' };
      let init: RequestInit | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, options) => {
          init = options;
          return new Response(null, { status: 201 });
        }),
      );
      const before = Math.floor(Date.now() / 1000);
      const response = await sendWebPush(
        { endpoint, keys: { p256dh: b64(receiverPublic), auth: b64(auth) } },
        payload,
        env,
      );
      expect(response.status).toBe(201);
      expect(init!.redirect).toBe('manual');
      const record = init!.body as Uint8Array;
      const salt = record.slice(0, 16);
      expect(new DataView(record.buffer).getUint32(16)).toBe(4096);
      expect(record[20]).toBe(65);
      const senderPublic = record.slice(21, 86);
      const senderKey = await crypto.subtle.importKey(
        'raw',
        senderPublic,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'ECDH', public: senderKey },
          receiver.privateKey,
          256,
        ),
      );
      const ikm = await hkdf(
        auth,
        shared,
        bytes(enc.encode('WebPush: info\0'), receiverPublic, senderPublic),
        32,
      );
      const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const clear = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, record.slice(86)),
      );
      expect(clear.at(-1)).toBe(2);
      expect(JSON.parse(new TextDecoder().decode(clear.slice(0, -1)))).toEqual(payload);
      const headers = new Headers(init!.headers);
      const authorization = headers.get('Authorization')!;
      const jwt = authorization.match(/^vapid t=([^,]+), k=/)![1];
      const [header, claims, signature] = jwt.split('.');
      const decoded = JSON.parse(new TextDecoder().decode(unb64(claims)));
      expect(decoded).toEqual({
        aud: new URL(endpoint).origin,
        sub: 'mailto:test@example.com',
        exp: expect.any(Number),
      });
      expect(decoded.exp).toBeGreaterThanOrEqual(before + 1800);
      expect(decoded.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1800);
      expect(JSON.parse(new TextDecoder().decode(unb64(header)))).toEqual({
        typ: 'JWT',
        alg: 'ES256',
      });
      expect(
        await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          vapid.publicKey,
          unb64(signature),
          enc.encode(header + '.' + claims),
        ),
      ).toBe(true);
    },
  );
});

import { settingsRecord, mergeServerSettings } from '../cloudflare/worker';
describe('QA account settings regressions', () => {
  it('validates the synced default translation and preserves independent preference edits', () => {
    for (const defaultTranslation of ['BSB', 'KJV', 'WEB', 'ESV'])
      expect(settingsRecord({ defaultTranslation, updatedAt: 1 }).defaultTranslation).toBe(
        defaultTranslation,
      );
    expect(() => settingsRecord({ defaultTranslation: 'NIV', updatedAt: 1 })).toThrow(
      'Invalid default translation',
    );
    const a = settingsRecord({
      defaultTranslation: 'ESV',
      keySounds: false,
      updatedAt: 30,
      fieldUpdatedAt: { defaultTranslation: 30, keySounds: 10 },
    });
    const b = settingsRecord({
      defaultTranslation: 'BSB',
      keySounds: true,
      updatedAt: 40,
      fieldUpdatedAt: { defaultTranslation: 10, keySounds: 40 },
    });
    expect(mergeServerSettings(a, b)).toMatchObject({ defaultTranslation: 'ESV', keySounds: true });
  });
  it('P2-16 rejects invalid server time zones', () => {
    expect(() => settingsRecord({ timeZone: 'Mars/Phobos', updatedAt: 1 })).toThrow(
      'Invalid timezone',
    );
    expect(settingsRecord({ timeZone: 'America/Los_Angeles', updatedAt: 1 }).timezone).toBe(
      'America/Los_Angeles',
    );
  });
  it('P2-17 normalizes display names and aliases consistently', () => {
    expect(settingsRecord({ name: ' Grace ', updatedAt: 1 })).toMatchObject({
      name: 'Grace',
      displayName: 'Grace',
    });
    expect(settingsRecord({ name: '   ', updatedAt: 1 })).toMatchObject({
      name: '',
      displayName: '',
    });
  });
  it('P1-18 normalizes field clocks and merges independent edits', () => {
    const old = settingsRecord({
        name: 'Grace',
        theme: 'light',
        updatedAt: 20,
        fieldUpdatedAt: { name: 20, theme: 10 },
      }),
      incoming = settingsRecord({
        name: '',
        theme: 'dark',
        updatedAt: 30,
        fieldUpdatedAt: { name: 10, theme: 30 },
      });
    expect(mergeServerSettings(old, incoming)).toMatchObject({
      name: 'Grace',
      displayName: 'Grace',
      theme: 'dark',
      appearance: 'dark',
    });
    expect(mergeServerSettings(incoming, old)).toEqual(mergeServerSettings(old, incoming));
    expect(() =>
      settingsRecord({ updatedAt: 1, fieldUpdatedAt: { name: Date.now() + 86400000 } }),
    ).toThrow();
  });
});

import { DatabaseSync } from 'node:sqlite';
import worker, { UserDO, RegistryDO, endpointHash, clientErrorRecord } from '../cloudflare/worker';
function stateForTest() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(query: string, ...args: any[]) {
      const statement = db.prepare(query);
      if (statement.columns().length) return statement.all(...args);
      statement.run(...args);
      return [];
    },
  };
  return {
    id: { toString: () => 'private-user-id' },
    storage: { sql, transactionSync: (fn: () => unknown) => fn() },
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
  } as unknown as DurableObjectState;
}
async function pushFixture() {
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const env = {
    DEPLOYMENT_ADAPTER: 'jesklabs',
    SESSION_SECRET: 'unit-test-secret-more-than-32-characters',
    VAPID_PUBLIC_KEY: b64(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey))),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d,
  } as Env;
  const object = new UserDO(stateForTest(), env),
    registryObject = new RegistryDO(stateForTest());
  const namespace = (target: UserDO | RegistryDO) => ({
    idFromName: (id: string) => id,
    get: () => ({
      fetch: (url: string, init: RequestInit) => target.fetch(new Request(url, init)),
    }),
  });
  env.USERS = namespace(object) as unknown as DurableObjectNamespace;
  env.REGISTRY = namespace(registryObject) as unknown as DurableObjectNamespace;
  const invoke = async (path: string, data: unknown = {}) =>
    (
      await object.fetch(
        new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }),
      )
    ).json<any>();
  await invoke('/init');
  const keys = {
    p256dh: b64(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))),
    auth: b64(crypto.getRandomValues(new Uint8Array(16))),
  };
  const subscription = { endpoint: 'https://web.push.apple.com/device/private-endpoint', keys };
  const token = await signSession(
    { uid: '11111111-1111-4111-8111-111111111111', version: 1, exp: Date.now() / 1000 + 60 },
    env.SESSION_SECRET,
  );
  const request = (path: string, data?: unknown) =>
    new Request('https://app.test' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: 'https://app.test',
        Cookie: 'bh_session=' + token,
        'Content-Type': 'application/json',
        'cf-ray': 'abc123-TEST',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const decrypt = async (init: RequestInit) => {
    const record = init.body as Uint8Array,
      sender = await crypto.subtle.importKey(
        'raw',
        record.slice(21, 86),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, receiver.privateKey, 256),
    );
    const ikm = await hkdf(
      unb64(keys.auth),
      shared,
      bytes(enc.encode('WebPush: info\0'), unb64(keys.p256dh), record.slice(21, 86)),
      32,
    );
    const cek = await hkdf(
        record.slice(0, 16),
        ikm,
        enc.encode('Content-Encoding: aes128gcm\0'),
        16,
      ),
      nonce = await hkdf(record.slice(0, 16), ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const clear = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, record.slice(86)),
    );
    return JSON.parse(new TextDecoder().decode(clear.slice(0, -1)));
  };
  return { env, invoke, subscription, request, decrypt };
}

describe('FIX6 push health and delivery records', () => {
  it('matches only SHA256 endpoint hashes and scopes removal to one device', async () => {
    const { env, subscription, request } = await pushFixture();
    const second = {
      ...subscription,
      endpoint: 'https://fcm.googleapis.com/device/second-private',
    };
    for (const sub of [subscription, second])
      expect(
        (await worker.fetch(request('/api/push/subscribe', { subscription: sub }), env)).status,
      ).toBe(200);
    const hash = await endpointHash(subscription.endpoint);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const status = await (
      await worker.fetch(request('/api/push/status?endpointHash=' + hash), env)
    ).json<any>();
    expect(status).toMatchObject({ subscribed: true, results: [] });
    expect(status.endpointHashes).toHaveLength(2);
    expect(JSON.stringify(status)).not.toContain('private-endpoint');
    await worker.fetch(
      request('/api/push/subscribe', { subscription: null, endpoint: subscription.endpoint }),
      env,
    );
    expect(
      await (await worker.fetch(request('/api/push/status?endpointHash=' + hash), env)).json(),
    ).toMatchObject({ subscribed: false });
    expect(
      await (
        await worker.fetch(
          request('/api/push/status?endpointHash=' + (await endpointHash(second.endpoint))),
          env,
        )
      ).json(),
    ).toMatchObject({ subscribed: true });
    expect(
      (await worker.fetch(request('/api/push/status?endpointHash=not-a-hash'), env)).status,
    ).toBe(400);
    expect((await worker.fetch(new Request('https://app.test/api/push/status'), env)).status).toBe(
      401,
    );
  });
  it('records successes, Apple rejections and network errors, retaining only the last ten without secrets', async () => {
    const { env, subscription, invoke, request } = await pushFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await invoke('/push/subscribe', { subscription });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
    const success = await (await worker.fetch(request('/api/push/test', {}), env)).json<any>();
    expect(success).toMatchObject({
      sent: 1,
      failed: 0,
      results: [{ host: 'web.push.apple.com', status: 201, reason: '' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"reason":"BadJwtToken"}', { status: 403 })),
    );
    for (let i = 0; i < 10; i++) await invoke('/push/test');
    expect(
      await invoke('/push/status', { endpointHash: await endpointHash(subscription.endpoint) }),
    ).toMatchObject({
      subscribed: true,
      results: Array.from({ length: 10 }, () => ({
        host: 'web.push.apple.com',
        status: 403,
        reason: '{"reason":"BadJwtToken"}',
      })),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error(subscription.endpoint + env.VAPID_PRIVATE_KEY)),
    );
    expect(await invoke('/push/test')).toMatchObject({
      sent: 0,
      failed: 1,
      results: [{ status: 0, reason: 'Push delivery failed' }],
    });
    const logs = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(logs).toHaveLength(12);
    expect(logs[0]).toMatchObject({
      evt: 'push',
      kind: 'test',
      status: 201,
      ms: expect.any(Number),
    });
    const serialized = JSON.stringify(logs);
    for (const secret of [
      subscription.endpoint,
      subscription.keys.auth,
      subscription.keys.p256dh,
      env.VAPID_PRIVATE_KEY!,
      'private-user-id',
    ])
      expect(serialized).not.toContain(secret);
  });
  it.each([301, 302, 307, 308])(
    'does not follow push redirect %i and records it as a failed delivery',
    async (status) => {
      const { subscription, invoke } = await pushFixture();
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await invoke('/push/subscribe', { subscription });
      const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.redirect).toBe('manual');
        return new Response('Moved', {
          status,
          headers: { Location: 'https://untrusted.example/collect' },
        });
      });
      vi.stubGlobal('fetch', fetch);
      expect(await invoke('/push/test')).toMatchObject({
        sent: 0,
        failed: 1,
        results: [{ status, reason: 'Moved' }],
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe(subscription.endpoint);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ evt: 'push', status });
      expect(
        await invoke('/push/status', { endpointHash: await endpointHash(subscription.endpoint) }),
      ).toMatchObject({ subscribed: true, results: [{ status }] });
    },
  );
  it.each([404, 410])(
    'counts expired status %i as failure and removes the stale subscription',
    async (status) => {
      const { subscription, invoke } = await pushFixture();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await invoke('/push/subscribe', { subscription });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('expired', { status })),
      );
      expect(await invoke('/push/test')).toMatchObject({
        sent: 0,
        failed: 1,
        results: [{ status }],
      });
      expect(
        await invoke('/push/status', { endpointHash: await endpointHash(subscription.endpoint) }),
      ).toMatchObject({ subscribed: false });
    },
  );
  it('redacts echoed push keys and endpoint URLs and bounds provider response reasons', async () => {
    const { subscription, invoke } = await pushFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await invoke('/push/subscribe', { subscription });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            subscription.endpoint + ' ' + subscription.keys.auth + ' ' + 'x'.repeat(400),
            { status: 403 },
          ),
      ),
    );
    const result = await invoke('/push/test');
    expect(result.results[0].reason).toHaveLength(200);
    expect(JSON.stringify(log.mock.calls)).not.toContain(subscription.endpoint);
    expect(JSON.stringify(log.mock.calls)).not.toContain(subscription.keys.auth);
  });
  it.each([1, 2])(
    'encrypts daily copy with the real due count (%i), and keeps test notifications distinct',
    async (count) => {
      const { subscription, invoke, decrypt } = await pushFixture();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await invoke('/push/subscribe', { subscription });
      const now = new Date();
      await invoke('/sync', {
        settings: {
          updatedAt: now.getTime(),
          remindersEnabled: true,
          timezone: 'UTC',
          reminderTime: now.toISOString().slice(11, 16),
        },
        items: [
          ...Array.from({ length: count }, (_, i) => ({
            id: 'due' + i,
            updatedAt: now.getTime(),
            learned: true,
            due: new Date(0).toISOString(),
          })),
          {
            id: 'future',
            updatedAt: now.getTime(),
            learned: true,
            due: new Date(now.getTime() + 86400000).toISOString(),
          },
          { id: 'deleted', updatedAt: now.getTime(), deleted: true },
        ],
      });
      const payloads: any[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init) => {
          payloads.push(await decrypt(init));
          return new Response(null, { status: 201 });
        }),
      );
      expect(await invoke('/push/remind')).toMatchObject({ sent: 1, failed: 0 });
      expect(payloads[0]).toMatchObject({
        body: `You have ${count} ${count === 1 ? 'item' : 'items'} to practice today.`,
        tag: 'by-heart-daily',
        renotify: false,
      });
      expect(await invoke('/push/remind')).toEqual({ sent: 0, failed: 0, results: [] });
      await invoke('/push/test');
      expect(payloads[1]).toMatchObject({
        body: 'Test notification. Reminders are working.',
        tag: 'by-heart-test',
        renotify: true,
      });
    },
  );
  it('accepts all synced text sizes and rejects unsupported values', () => {
    for (const textSize of ['small', 'default', 'large', 'extra-large'])
      expect(settingsRecord({ textSize, updatedAt: 1 }).textSize).toBe(textSize);
    expect(() => settingsRecord({ textSize: 'huge', updatedAt: 1 })).toThrow('Invalid text size');
  });
});

describe('FIX6 private first-party error logging', () => {
  it('only keeps error categories, app stack locations, canonical routes, version and UA family', () => {
    const result = clientErrorRecord(
      {
        message: 'Unhandled TypeError: PRIVATE VERSE',
        stack:
          'TypeError: PRIVATE VERSE\n at https://app.test/assets/app-a123.js:2:3\n/assets/app-a123.js:4:5\n at https://evil.test/private?secret=code:1:2',
        route: '/account?secret=code',
        version: 'a123456',
        ua: 'Safari',
        text: 'PRIVATE VERSE',
      },
      'https://app.test',
    );
    expect(result).toEqual({
      message: 'TypeError',
      stack: '/assets/app-a123.js:2:3\n/assets/app-a123.js:4:5',
      route: '/account',
      version: 'a123456',
      uaFamily: 'Safari',
    });
    expect(
      clientErrorRecord(
        {
          message: 'PRIVATE VERSE',
          route: '/private/secret',
          version: 'secret',
          ua: 'personal user agent',
        },
        'https://app.test',
      ),
    ).toEqual({
      message: 'Client error (message omitted)',
      stack: '',
      route: '/',
      version: 'unknown',
      uaFamily: 'Other',
    });
  });
  it('accepts signed-out same-origin reports, caps streamed bodies at 2KB, and rate-limits per IP', async () => {
    const { env } = await pushFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = (data: unknown, origin = 'https://app.test') =>
      worker.fetch(
        new Request('https://app.test/api/log', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '192.0.2.1',
          },
          body: JSON.stringify(data),
        }),
        env,
      );
    expect((await report({}, 'https://evil.test')).status).toBe(403);
    expect((await report({ message: 'x'.repeat(2048) })).status).toBe(413);
    for (let i = 0; i < 9; i++)
      expect((await report({ message: 'Error: private user text' })).status).toBe(200);
    expect((await report({})).status).toBe(429);
    expect(log).toHaveBeenCalledTimes(9);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      evt: 'client_error',
      message: 'Error',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private user text');
    expect(JSON.stringify(log.mock.calls)).not.toContain('192.0.2.1');
  });
  it('returns the cf-ray request id for expected 5xx and unexpected exceptions without leaking messages', async () => {
    const { env, request } = await pushFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const unavailable = await worker.fetch(request('/api/me'), { ...env, SESSION_SECRET: '' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ requestId: 'abc123-TEST' });
    env.USERS = {
      idFromName() {
        throw new Error('PRIVATE secret text');
      },
    } as unknown as DurableObjectNamespace;
    const failed = await worker.fetch(request('/api/me'), env);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ requestId: 'abc123-TEST' });
    expect(failed.headers.get('X-Request-ID')).toBe('abc123-TEST');
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        evt: 'server_error',
        status: 503,
        requestId: 'abc123-TEST',
        unexpected: false,
      }),
      expect.objectContaining({
        evt: 'server_error',
        status: 500,
        requestId: 'abc123-TEST',
        unexpected: true,
      }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
  });
  it('also logs upstream static asset 5xx responses', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await worker.fetch(new Request('https://app.test/assets/app.js'), {
      ASSETS: { fetch: async () => new Response('unavailable', { status: 502 }) },
    } as unknown as Env);
    expect(response.status).toBe(502);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      evt: 'server_error',
      status: 502,
      requestId: expect.any(String),
    });
  });
});

describe('Incord push origin migration', () => {
  it('retains old subscriptions until a new-origin replacement is registered', async () => {
    const { invoke, subscription } = await pushFixture();
    await invoke('/push/subscribe', { subscription, origin: 'https://byheart.jesklabs.com' });
    expect(await invoke('/push/status')).toMatchObject({
      oldOriginOnly: true,
      endpointHashes: expect.any(Array),
    });
    const replacement = {
      ...subscription,
      endpoint: 'https://web.push.apple.com/device/new-incord-endpoint',
    };
    await invoke('/push/subscribe', {
      subscription: replacement,
      origin: 'https://incord.jesklabs.com',
    });
    expect(
      await invoke('/push/status', { endpointHash: await endpointHash(replacement.endpoint) }),
    ).toMatchObject({
      subscribed: true,
      oldOriginOnly: false,
      endpointHashes: [await endpointHash(replacement.endpoint)],
    });
  });
});

describe('Incord ESV server boundaries', () => {
  it('strips device-only quotations before storage and export, and enforces the shared account cap', async () => {
    const { invoke } = await pushFixture();
    const item = {
      id: 'esv-gen-1-1',
      translation: 'ESV',
      reference: 'Genesis 1:1',
      text: 'publisher-private-text',
      esvVerseKeys: ['gen-1-1'],
      updatedAt: Date.now(),
    };
    expect((await invoke('/sync', { items: [item] })).items[0].text).toBe('');
    expect(JSON.stringify(await invoke('/export'))).not.toContain('publisher-private-text');
    const many = Array.from(
      { length: 500 },
      (_, i) => `psa-${Math.floor(i / 100) + 1}-${(i % 100) + 1}`,
    );
    expect(
      await invoke('/sync', { items: [{ ...item, id: 'esv-extra', esvVerseKeys: many }] }),
    ).toMatchObject({ error: expect.stringContaining('500') });
    expect((await invoke('/export')).items).toHaveLength(1);
  });
  it('limits anonymous ESV requests to 30 per IP/hour without persisting text', async () => {
    const { env } = await pushFixture();
    env.ESV_API_KEY = 'unit-api-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ passages: ['  Exact publisher text.\n'] })),
    );
    for (let n = 0; n < 30; n++) {
      const response = await worker.fetch(
        new Request('https://app.test/api/esv?q=John%203:16'),
        env,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('  Exact publisher text.\n');
      expect(response.headers.get('Cache-Control')).toContain('no-store');
    }
    expect(
      (await worker.fetch(new Request('https://app.test/api/esv?q=John%203:16'), env)).status,
    ).toBe(429);
  });
});

it('ignores removed typing preference even when its retired field clock is invalid', () => {
  const legacy = {
    typingMode: 'native',
    peekNoteDismissed: true,
    haptics: true,
    updatedAt: 20,
    fieldUpdatedAt: { typingMode: Infinity, peekNoteDismissed: Infinity, haptics: 20 },
  };
  const validated = settingsRecord(legacy);
  expect(validated).not.toHaveProperty('typingMode');
  expect(validated.fieldUpdatedAt).not.toHaveProperty('typingMode');
  expect(validated).not.toHaveProperty('peekNoteDismissed');
  expect(validated.fieldUpdatedAt).not.toHaveProperty('peekNoteDismissed');
  const merged = mergeServerSettings(
    { ...legacy, keySounds: true },
    { updatedAt: 30, haptics: false, fieldUpdatedAt: { haptics: 30 } },
  );
  expect(merged).toMatchObject({ haptics: false, keySounds: true });
  expect(merged).not.toHaveProperty('typingMode');
  expect(merged.fieldUpdatedAt).not.toHaveProperty('typingMode');
  expect(merged).not.toHaveProperty('peekNoteDismissed');
  expect(merged.fieldUpdatedAt).not.toHaveProperty('peekNoteDismissed');
});

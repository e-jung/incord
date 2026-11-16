import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker, { RegistryDO, type Env } from '../cloudflare/worker';

const oldOrigin = 'https://byheart.jesklabs.com';
const newOrigin = 'https://incord.jesklabs.com';
function fixture() {
  const db = new DatabaseSync(':memory:');
  const state = {
    storage: {
      sql: {
        exec(query: string, ...args: any[]) {
          const s = db.prepare(query);
          return s.columns().length ? s.all(...args) : (s.run(...args), []);
        },
      },
      transactionSync: (fn: () => unknown) => fn(),
    },
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
  } as unknown as DurableObjectState;
  const registry = new RegistryDO(state);
  const assets = vi.fn(
    async () => new Response('<h1>Incord</h1>', { headers: { 'Content-Type': 'text/html' } }),
  );
  const env = {
    SESSION_SECRET: 'migration-unit-test-secret-over-32-characters',
    ASSETS: { fetch: assets },
    REGISTRY: {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: (url: string, init: RequestInit) => registry.fetch(new Request(url, init)),
      }),
    },
  } as unknown as Env;
  return { env, assets, db };
}
const post = (origin: string, path: string, data: unknown = {}, cookie?: string) =>
  new Request(origin + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(data),
  });

describe('FIX-7 migration responses', () => {
  it.each(['/', '/library?source=installed', '/assets/old.js?version=1', '/manifest.webmanifest'])(
    'permanently redirects old host %s preserving path and query',
    async (path) => {
      const { env, assets } = fixture();
      const response = await worker.fetch(new Request(oldOrigin + path), env);
      expect(response.status).toBe(301);
      expect(response.headers.get('Location')).toBe(newOrigin + path);
      expect(assets).not.toHaveBeenCalled();
      expect(response.headers.get('Strict-Transport-Security')).toBeTruthy();
    },
  );
  it('upgrades old HTTP requests to canonical HTTPS', async () => {
    const { env } = fixture();
    const response = await worker.fetch(
      new Request('http://byheart.jesklabs.com/library?q=1'),
      env,
    );
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe(newOrigin + '/library?q=1');
  });
  it.each(['GET', 'POST', 'DELETE'])(
    'retires old API with 410, not a cross-origin write redirect (%s)',
    async (method) => {
      const { env, assets } = fixture();
      const response = await worker.fetch(new Request(oldOrigin + '/api/sync', { method }), env);
      expect(response.status).toBe(410);
      expect(response.headers.get('Location')).toBeNull();
      expect(await response.json()).toMatchObject({ error: expect.stringContaining(newOrigin) });
      expect(assets).not.toHaveBeenCalled();
    },
  );
  it('redirects the retired related-origin metadata path like other legacy pages', async () => {
    const { env, assets } = fixture();
    const response = await worker.fetch(new Request(oldOrigin + '/.well-known/webauthn'), env);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe(newOrigin + '/.well-known/webauthn');
    expect(assets).not.toHaveBeenCalled();
  });
  it('serves an uncached self-unregistering old worker with navigation migration', async () => {
    const { env, assets } = fixture();
    const response = await worker.fetch(new Request(oldOrigin + '/sw.js'), env);
    const script = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('javascript');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Service-Worker-Allowed')).toBe('/');
    expect(script).toContain('skipWaiting');
    expect(script).toContain('registration.unregister()');
    expect(script).toContain('client.navigate');
    expect(script).toContain("url.hostname='incord.jesklabs.com'");
    expect(assets).not.toHaveBeenCalled();
  });
  it('does not redirect similar-looking hosts or intercept new-origin assets', async () => {
    const { env, assets } = fixture();
    for (const origin of [newOrigin, 'https://byheart.jesklabs.com.evil.test']) {
      const response = await worker.fetch(new Request(origin + '/'), env);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Incord');
    }
    expect(assets).toHaveBeenCalledTimes(2);
  });
  it.each([
    '/api/auth/register/options',
    '/api/auth/register/verify',
    '/api/auth/login/options',
    '/api/auth/login/verify',
    '/api/auth/recover',
  ])('does not create legacy auth state for %s', async (path) => {
    const { env, db } = fixture();
    expect((await worker.fetch(post(newOrigin, path, { legacy: true }), env)).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM challenges').get()!.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mapping').get()!.n).toBe(0);
  });
  it('still rejects cross-origin writes before creating an OAuth challenge', async () => {
    const { env, db } = fixture();
    const request = post(newOrigin, '/api/auth/email/start', { email: 'test@example.com' });
    request.headers.set('Origin', oldOrigin);
    expect((await worker.fetch(request, env)).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM challenges').get()!.n).toBe(0);
  });
});

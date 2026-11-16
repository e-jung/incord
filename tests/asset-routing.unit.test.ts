import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import legacy from '../cloudflare/legacy-redirect/worker';

const config = JSON.parse(
  readFileSync('wrangler.jsonc', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n'),
);
// Cloudflare documents deep '*' matching; negative matches override all positives,
// regardless of order. No negations are used: they force asset-only misses too.
function workerFirst(path: string) {
  const patterns = config.assets.run_worker_first as string[];
  const matches = (pattern: string) =>
    new RegExp(
      '^' +
        pattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$',
    ).test(path);
  return (
    patterns.some((pattern) => !pattern.startsWith('!') && matches(pattern)) &&
    !patterns.some((pattern) => pattern.startsWith('!') && matches(pattern.slice(1)))
  );
}

describe('asset-first routing configuration', () => {
  it.each([
    '/api',
    '/api/config',
    '/api/auth/google/callback',
    '/api/oauth/authorize',
    '/api/stats',
    '/mcp',
    '/mcp/nested',
    '/mcp-extra',
    '/oauth',
    '/oauth/token',
    '/oauth/register',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/stats',
    '/stats/logout',
    '/stats/maintenance/orphans',
    '/stats-extra',
    '/join',
    '/join/code',
    '/.well-known/webauthn',
  ])('always sends dynamic path %s to the Worker', (path) => expect(workerFirst(path)).toBe(true));
  it.each([
    '/',
    '/index.html',
    '/gallery',
    '/connect.html',
    '/privacy.html',
    '/sw.js',
    '/assets/app.js',
    '/assets/stats.css',
    '/assets/font.woff2',
    '/content/bsb/jhn.json',
    '/audio/key.mp3',
    '/manifest.webmanifest',
  ])('allows static path %s to use asset-first routing', (path) =>
    expect(workerFirst(path)).toBe(false),
  );
  it('lets asset misses reach the existing precise Worker fallback instead of unconditional SPA rewrites', () => {
    expect(config.assets.not_found_handling).toBe('none');
    expect(
      config.assets.run_worker_first.every((pattern: string) => !pattern.startsWith('!')),
    ).toBe(true);
    expect(config.routes).toEqual([{ pattern: 'incord.jesklabs.com', custom_domain: true }]);
  });
  it('isolates the old host in a Worker without application state or assets', () => {
    const redirect = JSON.parse(readFileSync('cloudflare/legacy-redirect/wrangler.jsonc', 'utf8'));
    expect(redirect.name).toBe('byheart-legacy-redirect');
    expect(redirect.routes).toEqual([{ pattern: 'byheart.jesklabs.com', custom_domain: true }]);
    expect(redirect.assets).toBeUndefined();
    expect(redirect.durable_objects).toBeUndefined();
    expect(redirect.vars).toBeUndefined();
  });
});

describe('standalone legacy migration Worker', () => {
  it.each(['/', '/library?q=one%20two', '/assets/old.js?v=1', '/manifest.webmanifest'])(
    'redirects %s with path and query intact',
    (path) => {
      const response = legacy.fetch(new Request('http://byheart.jesklabs.com:8080' + path));
      expect(response.status).toBe(301);
      expect(response.headers.get('Location')).toBe('https://incord.jesklabs.com' + path);
      expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    },
  );
  it.each(['GET', 'POST', 'DELETE', 'OPTIONS'])(
    'retires old APIs without redirect (%s)',
    async (method) => {
      const response = legacy.fetch(
        new Request('https://byheart.jesklabs.com/api/sync', { method }),
      );
      expect(response.status).toBe(410);
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: 'Incord has moved. Update this app at https://incord.jesklabs.com.',
      });
    },
  );
  it('returns empty HEAD bodies for the retirement and service-worker endpoints', async () => {
    for (const path of ['/sw.js', '/api/sync'])
      expect(
        await legacy
          .fetch(new Request('https://byheart.jesklabs.com' + path, { method: 'HEAD' }))
          .text(),
      ).toBe('');
  });
  it('serves a noncached unregister worker and migrates existing window clients', async () => {
    const response = legacy.fetch(new Request('https://byheart.jesklabs.com/sw.js?v=old'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Service-Worker-Allowed')).toBe('/');
    const handlers: Record<string, (event?: any) => void> = {};
    const navigated: string[] = [];
    let unregistered = false;
    let skipped = false;
    runInNewContext(await response.text(), {
      URL,
      Response,
      self: {
        addEventListener: (name: string, callback: any) => {
          handlers[name] = callback;
        },
        skipWaiting: () => {
          skipped = true;
        },
        registration: {
          unregister: async () => {
            unregistered = true;
          },
        },
        clients: {
          matchAll: async () => [
            {
              url: 'https://byheart.jesklabs.com/library?q=1',
              navigate: async (url: string) => {
                navigated.push(url);
              },
            },
          ],
        },
      },
    });
    handlers.install();
    expect(skipped).toBe(true);
    let activation!: Promise<void>;
    handlers.activate({
      waitUntil: (promise: Promise<void>) => {
        activation = promise;
      },
    });
    await activation;
    expect(unregistered).toBe(true);
    expect(navigated).toEqual(['https://incord.jesklabs.com/library?q=1']);
    let redirect!: Response;
    handlers.fetch({
      request: { url: 'https://byheart.jesklabs.com/practice?q=2', mode: 'navigate' },
      respondWith: (response: Response) => {
        redirect = response;
      },
    });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('Location')).toBe('https://incord.jesklabs.com/practice?q=2');
    handlers.fetch({
      request: { url: 'https://byheart.jesklabs.com/assets/old.js', mode: 'cors' },
      respondWith: () => {
        throw Error('must not intercept non-navigation');
      },
    });
  });
});

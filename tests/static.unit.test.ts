import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import worker, { type Env } from '../cloudflare/worker';
import { lookupReference } from '../src/content';
import { contentCopy } from '../src/config/copy';

const assetEnv = (fetch: (request: Request) => Promise<Response>) => ({ ASSETS: { fetch } }) as unknown as Env;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Cloudflare runtime compatibility', () => {
  it('never configures Worker fetches with the unsupported error redirect mode', () => {
    const source = readFileSync('cloudflare/worker.ts', 'utf8');
    expect(source).not.toMatch(/(?:\bredirect|['"]redirect['"])\s*:\s*(['"])error\1/);
  });
});

describe('N5/N6 response headers and N18 static routing', () => {
  it.each(['/', '/gallery', '/index.html'])('protects HTML at %s without relaxing the enforcing CSP', async path => {
    const response = await worker.fetch(new Request('https://example.test' + path), assetEnv(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0' } })));
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, no-transform');
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self';");
    expect(response.headers.get('Content-Security-Policy')).not.toContain('cloudflareinsights');
  });
  it('preserves an existing no-transform directive without duplicating it', async () => {
    const response = await worker.fetch(new Request('https://example.test/'), assetEnv(async () => new Response('', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-transform' } })));
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
  });
  it.each(['/content/bsb/nope.json', '/assets/nope.js', '/content/missing', '/assets/missing', '/.env'])('keeps %s a real 404, including HTML navigations', async path => {
    const fetch = vi.fn(async () => new Response('Not found', { status: 404 }));
    const response = await worker.fetch(new Request('https://example.test' + path, { headers: { Accept: 'text/html' } }), assetEnv(fetch));
    expect(response.status).toBe(404); expect(fetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain('<html');
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });
  it('falls back to the shell only for extensionless HTML app navigation', async () => {
    const fetch = vi.fn(async (request: Request) => new URL(request.url).pathname === '/' ? new Response('<html>shell</html>', { headers: { 'Content-Type': 'text/html' } }) : new Response('Not found', { status: 404 }));
    const response = await worker.fetch(new Request('https://example.test/gallery', { headers: { Accept: 'text/html' } }), assetEnv(fetch));
    expect(response.status).toBe(200); expect(await response.text()).toContain('shell'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.headers.get('Cache-Control')).toContain('no-transform');
  });
  it('does not fallback for fetch requests or writes', async () => {
    for (const request of [new Request('https://example.test/missing'), new Request('https://example.test/missing', { method: 'POST', headers: { Accept: 'text/html' } })]) {
      const fetch = vi.fn(async () => new Response('Not found', { status: 404 }));
      expect((await worker.fetch(request, assetEnv(fetch))).status).toBe(404); expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('adds HSTS to successful assets, APIs, redirects and failures', async () => {
    const request = new Request('https://example.test/assets/existing.js');
    for (const source of [new Response('script', { headers: { 'Cache-Control': 'public, max-age=31536000' } }), new Response(null, { status: 302, headers: { Location: '/other' } })]) {
      const response = await worker.fetch(request, assetEnv(async () => source));
      expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
      expect(response.headers.get('Cache-Control')).toBe(source.headers.get('Cache-Control'));
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = await worker.fetch(request, assetEnv(async () => { throw Error('asset failure'); }));
    expect(failure.status).toBe(500); expect(failure.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    const api = await worker.fetch(new Request('https://example.test/api/config'), {} as Env);
    expect(api.status).toBe(200); expect(api.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(api.headers.get('Cache-Control')).toBe('no-store');
  });
  it('keeps every request worker-first and disables automatic asset SPA fallback', () => {
    const config = readFileSync('wrangler.jsonc', 'utf8');
    expect(config).toContain('"not_found_handling": "none"');
    expect(config).toContain('"run_worker_first": true');
  });
  it('never serves the offline SPA shell for static-path navigations', async () => {
    const handlers: Record<string, (event: any) => void> = {};
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      URL, Response, location: { origin: 'https://example.test' },
      self: { location: { hostname: 'example.test', origin: 'https://example.test' }, addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
      caches: { match: async (key: unknown) => key === '/' ? new Response('<html>offline shell</html>') : undefined },
      fetch: async () => { throw Error('offline'); },
    });
    for (const path of ['/stats', '/stats/logout']) {
      let intercepted = false;
      handlers.fetch({ request: { url: 'https://example.test' + path, method: 'GET', mode: 'navigate' }, respondWith: () => { intercepted = true; } });
      expect(intercepted, 'Private stats must always authenticate against the network').toBe(false);
    }
    for (const path of ['/assets/missing.js', '/content/missing.json', '/gallery']) {
      let result!: Promise<Response>;
      handlers.fetch({ request: { url: 'https://example.test' + path, method: 'GET', mode: 'navigate' }, respondWith: (response: Promise<Response>) => { result = response; } });
      const response = await result;
      if (path === '/gallery') expect(await response.text()).toContain('offline shell');
      else expect(response.type).toBe('error');
    }
  });
  it('explains a missing book and retries instead of retaining the rejected cache entry', async () => {
    const fetch = vi.fn(async () => new Response('Not found', { status: 404 })); vi.stubGlobal('fetch', fetch);
    await expect(lookupReference('Obadiah 1:1')).rejects.toThrow(contentCopy.offline);
    await expect(lookupReference('Obadiah 1:1')).rejects.toThrow(contentCopy.offline);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('N17 font bundle and precache', () => {
  it('imports only WOFF2 Latin/Latin-ext faces with complementary unicode ranges', () => {
    expect(readFileSync('src/main.ts', 'utf8')).not.toContain('@fontsource/');
    const css = readFileSync('src/fonts.css', 'utf8');
    const files = [...css.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]);
    expect(files).toHaveLength(12);
    expect(files.every(file => /-(?:latin|latin-ext)-(?:400|500|600|700|800)-normal\.woff2$/.test(file))).toBe(true);
    expect(css.match(/unicode-range:/g)).toHaveLength(12);
  });
  it('precache includes only WOFF2 Latin fonts and invalidates when that shell changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'byheart-sw-'));
    try {
      mkdirSync(join(root, 'public')); mkdirSync(join(root, 'dist/assets'), { recursive: true });
      writeFileSync(join(root, 'public/sw.js'), readFileSync('public/sw.js'));
      for (const file of ['app-abc.js', 'app-def.css', 'figtree-latin-400-normal-a.woff2', 'figtree-latin-ext-400-normal-b.woff2', 'figtree-latin-400-normal-c.woff', 'literata-greek-400-normal-d.woff2', 'font.ttf', 'font.otf']) writeFileSync(join(root, 'dist/assets', file), '');
      const build = () => { execFileSync(process.execPath, [resolve('scripts/build-sw.mjs')], { cwd: root }); return readFileSync(join(root, 'dist/sw.js'), 'utf8'); };
      const result = build();
      const shell = JSON.parse(result.match(/c\.addAll\((\[[^\]]+\])\)/)![1]) as string[];
      expect(shell).toEqual(['/', '/manifest.webmanifest', '/icon-192.png', '/assets/app-abc.js', '/assets/app-def.css', '/assets/figtree-latin-400-normal-a.woff2', '/assets/figtree-latin-ext-400-normal-b.woff2']);
      expect(build()).toBe(result);
      writeFileSync(join(root, 'dist/assets', 'app-new.js'), '');
      expect(build().match(/const CACHE='([^']+)'/)![1]).not.toBe(result.match(/const CACHE='([^']+)'/)![1]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

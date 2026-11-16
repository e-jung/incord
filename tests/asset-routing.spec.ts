import { test, expect, type APIResponse } from '@playwright/test';

function security(response: APIResponse, path: string) {
  const headers = response.headers();
  expect(headers['strict-transport-security'], path).toBe('max-age=31536000');
  expect(headers['x-content-type-options'], path).toBe('nosniff');
  expect(headers['referrer-policy'], path).toBe('no-referrer');
  expect(headers['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()');
  expect(headers['content-security-policy'], path).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
}

test('asset-first files retain finish security headers without invoking the Worker', async ({
  request,
}) => {
  const shell = await request.get('/');
  const html = await shell.text();
  const bundle = html.match(/(?:src|href)="(\/assets\/[^" ]+\.js)"/)![1];
  const css = html.match(/href="(\/assets\/[^" ]+\.css)"/)![1];
  const stylesheet = await (await request.get(css)).text();
  const font = stylesheet.match(/url\((?:["'])?(\/assets\/[^)"']+\.woff2)/)![1];
  for (const path of [
    '/',
    '/index.html',
    '/privacy.html',
    '/connect.html',
    '/sw.js',
    '/manifest.webmanifest',
    '/content/bsb/jhn.json',
    '/assets/stats.css',
    bundle,
    css,
    font,
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    security(response, path);
    expect(response.headers()['x-request-id'], path).toBeUndefined();
    if (response.headers()['content-type']?.includes('text/html'))
      expect(response.headers()['cache-control'], path).toContain('no-transform');
    if (path === '/sw.js') {
      expect(response.headers()['cache-control']).toContain('no-cache');
      expect(response.headers()['service-worker-allowed']).toBe('/');
    }
  }
});

test('missing static navigations and non-navigations remain 404 while HTML app routes work', async ({
  request,
}) => {
  for (const mode of ['navigate', 'cors']) {
    for (const path of [
      '/assets/nope.js',
      '/assets/nope',
      '/content/bsb/nope.json',
      '/content/nope',
      '/assets',
      '/content',
      '/missing.js',
      '/.env',
    ]) {
      const response = await request.get(path, {
        headers: { Accept: 'text/html', 'Sec-Fetch-Mode': mode },
      });
      expect(response.status(), path + ':' + mode).toBe(404);
      security(response, path);
      expect(await response.text(), path).not.toMatch(/<!doctype html>/i);
    }
  }
  for (const mode of ['navigate', 'cors']) {
    const response = await request.get('/library?source=deep-link', {
      headers: { Accept: 'text/html', 'Sec-Fetch-Mode': mode },
    });
    expect(response.status()).toBe(200);
    security(response, '/library');
    expect(response.headers()['cache-control']).toContain('no-transform');
    expect(await response.text()).toMatch(/<!doctype html>/i);
  }
  for (const path of ['/join/example-code', '/connect', '/privacy', '/haptics-lab', '/sound-lab']) {
    const response = await request.get(path, {
      headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(response.status(), path).toBe(200);
    security(response, path);
    expect(await response.text(), path).toMatch(/<!doctype html>/i);
    expect(response.headers()['cache-control'], path).toContain('no-transform');
  }
  const nonHtml = await request.get('/library', {
    headers: { Accept: 'application/json', 'Sec-Fetch-Mode': 'cors' },
  });
  expect(nonHtml.status()).toBe(404);
});

test('dynamic navigation paths always reach the Worker, never the app-shell fallback', async ({
  request,
}) => {
  for (const path of [
    '/api/config',
    '/api/no-such-route',
    '/api/stats',
    '/mcp',
    '/oauth/token',
    '/oauth/register',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/stats',
  ]) {
    const response = await request.get(path, {
      headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
      maxRedirects: 0,
    });
    expect(response.headers()['x-request-id'], path).toBeTruthy();
    expect(await response.text(), path).not.toContain('<div id="app">');
    expect(response.status(), path).toBeLessThan(500);
    expect(response.headers()['strict-transport-security'], path).toBe('max-age=31536000');
  }
});

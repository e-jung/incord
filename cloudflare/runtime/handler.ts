import { deployment } from '../deployment';
import { AccountsError } from '../accounts';
import { FeedbackError } from '../feedback';
import { GroupsError } from '../groups';
import { handleStatsRequest } from '../stats';
import { jesklabsAuth } from './auth';
import { ApiError, json } from './common';
import { maintainAccountsImport, maintainOrphans } from './maintenance';
import { scheduleReminders } from './push';
import { api } from './routing';
import { Env } from './types';

export function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  // Cloudflare Web Analytics documents no-transform as disabling automatic
  // beacon injection: https://developers.cloudflare.com/web-analytics/faq/
  // Preserve existing cache policy; the static shell is never personalized.
  if (headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'text/html') {
    const cache = headers.get('Cache-Control');
    if (!cache?.split(',').some((value) => value.trim().toLowerCase() === 'no-transform')) {
      headers.set('Cache-Control', [cache, 'no-transform'].filter(Boolean).join(', '));
    }
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  // Same-origin form POSTs need an Origin header; no-referrer makes Chromium send null.
  headers.set(
    'Referrer-Policy',
    headers.get('Referrer-Policy') === 'same-origin' ? 'same-origin' : 'no-referrer',
  );
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' da" +
      "ta: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; ob" +
      "ject-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  return new Response(response.body, { status: response.status, headers });
}

export function legacyServiceWorker(origin: string) {
  const hostname = new URL(origin).hostname;
  return (
    "self.addEventListener('install',()=>self.skipWaiting());\n" +
    "self.addEventListener('activate',event=>event.waitUntil((async()=>{" +
    'await self.registration.unregister();for(const client of await self.clients.matchAll(' +
    "{type:'window',includeUncontrolled:true})){const url=new URL(client.url);" +
    `url.hostname='${hostname}';url.protocol='https:';url.port='';await client.navigate(url.href)}})()));\n` +
    "self.addEventListener('fetch',event=>{const url=new URL(event.request.url);" +
    `if(event.request.mode==='navigate'){url.hostname='${hostname}';url.protocol='https:';` +
    "url.port='';event.respondWith(Response.redirect(url.href,301))}});"
  );
}

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId =
      request.headers
        .get('cf-ray')
        ?.replace(/[^a-zA-Z0-9-]/g, '')
        .slice(0, 100) || crypto.randomUUID();
    const finish = async (response: Response, unexpected = false, errorName?: string) => {
      if (response.status >= 500) {
        console.log(
          JSON.stringify({
            evt: 'server_error',
            requestId,
            status: response.status,
            unexpected,
            ...(errorName ? { errorName } : {}),
          }),
        );
      }
      if (
        response.status >= 400 &&
        !/^\/(?:mcp(?:\/|$)|oauth(?:\/|$)|\.well-known\/oauth-)/.test(
          new URL(request.url).pathname,
        ) &&
        (new URL(request.url).pathname.startsWith('/api/') ||
          response.headers.get('Content-Type')?.includes('application/json'))
      ) {
        let error = 'Something went wrong. Please try again.';
        let retryAfter: number | undefined;
        try {
          const data = await response.json<{ error?: string; retryAfter?: number }>();
          if (data.error) error = data.error;
          retryAfter = data.retryAfter;
        } catch {
          /* Do not log response content. */
        }
        response = json(
          { error, requestId, ...(retryAfter ? { retryAfter } : {}) },
          response.status,
          retryAfter ? { 'Retry-After': String(retryAfter) } : undefined,
        );
      }
      const result = secure(response);
      result.headers.set('X-Request-ID', requestId);
      return result;
    };
    try {
      const url = new URL(request.url),
        path = url.pathname;
      const migration = deployment(env).migration;
      if (migration && url.hostname === new URL(migration.legacyOrigin).hostname) {
        if (path === '/sw.js')
          return finish(
            new Response(legacyServiceWorker(migration.origin), {
              headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-store',
                'Service-Worker-Allowed': '/',
              },
            }),
          );
        if (path === '/auth/jesklabs/callback')
          return await finish(await jesklabsAuth(request, env));
        if (path.startsWith('/api/'))
          return finish(
            json({ error: `Incord has moved. Update this app at ${migration.origin}.` }, 410),
          );
        return finish(Response.redirect(migration.origin + url.pathname + url.search, 301));
      }
      const mcpResponse = /^\/(?:mcp(?:\/|$)|oauth\/(?:token|register)$|\.well-known\/oauth-)/.test(
        path,
      )
        ? await (await import('../mcp')).handleMcpRequest(request, env, ctx)
        : null;
      if (mcpResponse) return await finish(mcpResponse);
      if (path === '/stats/maintenance/accounts-import')
        return await finish(await maintainAccountsImport(request, env));
      if (path === '/stats/maintenance/orphans')
        return await finish(await maintainOrphans(request, env));
      const statsResponse = await handleStatsRequest(request, env);
      if (statsResponse) return await finish(statsResponse);
      if (path === '/auth/jesklabs/callback') return await finish(await jesklabsAuth(request, env));
      if (path.startsWith('/api/')) return await finish(await api(request, env));
      let response = await env.ASSETS.fetch(request);
      // Static misses stay 404; only extensionless HTML app routes get the shell.
      if (
        response.status === 404 &&
        ['GET', 'HEAD'].includes(request.method) &&
        !/^\/(content|assets)(?:\/|$)/.test(path) &&
        !path.split('/').some((part) => part.includes('.')) &&
        request.headers.get('Accept')?.includes('text/html')
      ) {
        response = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      }
      return await finish(response);
    } catch (error) {
      if (error instanceof AccountsError)
        return finish(
          json(
            { error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) },
            error.status,
            error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined,
          ),
        );
      if (
        error instanceof ApiError ||
        error instanceof FeedbackError ||
        error instanceof GroupsError
      )
        return finish(json({ error: error.message }, error.status));
      return finish(
        json({ error: 'Something went wrong. Please try again.' }, 500),
        true,
        error instanceof Error &&
          ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'].includes(error.name)
          ? error.name
          : 'Error',
      );
    }
  },
  scheduled: scheduleReminders,
} satisfies ExportedHandler<Env>;
export default handler;

import { handleEsv, assertEsvLimit, stripEsvText } from './esv';
import { handleStatsRequest } from './stats';
export { StatsDO } from './stats';
export { OAuthStorageDO } from './oauth-storage';
import { oauthCall } from './oauth-storage';

export interface Env {
  ASSETS: Fetcher;
  OAUTH_STORAGE: DurableObjectNamespace;
  STATS: DurableObjectNamespace;
  STATS_TOKEN?: string;
  ESV_API_KEY?: string;
  USERS: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace;
  SESSION_SECRET: string;
  APP_ORIGIN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_TEST_SINK?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
type ObjectData = Record<string, unknown>;
type Row = Record<string, string | number | null>;
type Session = { uid: string; version: number; exp: number };
type Challenge = { challenge: string; kind: 'google'; verifier: string };
const encoder = new TextEncoder();
const SESSION_AGE = 30 * 86400;
const cookieName = 'bh_session';
const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function assert(ok: unknown, message = 'Invalid request', status = 400): asserts ok { if (!ok) throw new ApiError(status, message); }
export function b64(data: Uint8Array): string { return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
export function unb64(data: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
const random = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));
async function digest(value: string) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function hmac(secret: string, data: string) { const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))); }
/** Rejection sampling keeps all million possible codes equally likely. */
export function generateLoginCode() { const value = new Uint32Array(1); do { crypto.getRandomValues(value); } while (value[0] >= 4_294_000_000); return String(value[0] % 1_000_000).padStart(6, '0'); }
export function normalizeEmail(value: unknown) { assert(typeof value === 'string', 'Enter a valid email address.'); const email = value.trim().toLowerCase(); assert(email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email), 'Enter a valid email address.'); return email; }
export const emailKey = (env: Env, email: string) => hmac(env.SESSION_SECRET, 'email:' + normalizeEmail(email));
export const loginCodeHash = (env: Env, key: string, code: string) => hmac(env.SESSION_SECRET, 'email-code:' + key + ':' + code);
export function constantTimeEqual(a: string, b: string) { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; }
export function emailTestMode(env: Env, request: Request) { return env.EMAIL_TEST_SINK === '1' && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname); }
function emailEnabled(env: Env, request: Request) { return !!(env.RESEND_API_KEY || emailTestMode(env, request)); }
export async function sendLoginCode(env: Env, to: string, code: string) {
  const message = { from: env.EMAIL_FROM || 'Incord <signin@incord.jesklabs.com>', reply_to: 'incord-support@googlegroups.com', to, subject: `Your Incord code: ${code}`, text: `Your Incord sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for this code, ignore this email.`, html: `<p>Your Incord sign-in code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you didn't ask for this code, ignore this email.</p>` };
  if (env.RESEND_API_KEY) { try { const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(message) }); assert(response.ok, 'We couldn’t send your code. Please try again shortly.', 503); } catch { throw new ApiError(503, 'We couldn’t send your code. Please try again shortly.'); } }
  else throw new ApiError(404, 'Email sign-in is not enabled.');
}
async function identityFlags(env: Env, uid: string) { return registry(env, '/identity', { uid }); }
export async function signSession(session: Session, secret: string) { const value = b64(encoder.encode(JSON.stringify(session))); return value + '.' + await hmac(secret, value); }
export async function readSession(value: string | undefined, secret: string): Promise<Session | null> {
  try { if (!value || value.length > 2048) return null; const [payload, signature, extra] = value.split('.'); if (extra || !signature) return null;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, unb64(signature), encoder.encode(payload))) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64(payload))) as Session;
    return typeof s.uid === 'string' && /^[a-f0-9-]{36}$/.test(s.uid) && Number.isInteger(s.version) && s.exp > Date.now() / 1000 ? s : null;
  } catch { return null; }
}
function cookies(request: Request): Record<string, string> { return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2)); }
function cookie(name: string, value: string, age: number, origin: string) { return `${name}=${value}; HttpOnly; ${origin.startsWith('https:') ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${age}`; }
async function body(request: Request, maxBytes = 2_000_000): Promise<ObjectData> {
  assert(!request.headers.get('Content-Length') || Number(request.headers.get('Content-Length')) <= maxBytes, 'Request too large', 413);
  assert(request.headers.get('Content-Type')?.includes('application/json'), 'Expected application/json', 415);
  // Stream cap also covers chunked requests without Content-Length.
  const reader = request.body?.getReader(); assert(reader, 'Missing body'); const parts: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'Request too large'); } parts.push(part.value); }
  const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; }
  let result: unknown; try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, 'Invalid JSON'); }
  assert(result && typeof result === 'object' && !Array.isArray(result)); return result as ObjectData;
}
function stub(env: Env, uid: string) { return env.USERS.get(env.USERS.idFromName(uid)); }
async function call(target: DurableObjectStub, path: string, data: unknown = {}) { const response = await target.fetch('https://internal' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) { const problem = await response.json<{ error: string }>(); throw new ApiError(response.status, problem.error); } return response.json<any>(); }
const registry = (env: Env, path: string, data: unknown = {}) => call(env.REGISTRY.get(env.REGISTRY.idFromName('registry')), path, data);
const user = (env: Env, uid: string, path: string, data: unknown = {}) => call(stub(env, uid), path, data);
function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  // Cloudflare Web Analytics documents no-transform as disabling automatic
  // beacon injection: https://developers.cloudflare.com/web-analytics/faq/
  // Preserve existing cache policy; the static shell is never personalized.
  if (headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'text/html') {
    const cache = headers.get('Cache-Control');
    if (!cache?.split(',').some(value => value.trim().toLowerCase() === 'no-transform')) {
      headers.set('Cache-Control', [cache, 'no-transform'].filter(Boolean).join(', '));
    }
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  // Same-origin form POSTs need an Origin header; no-referrer makes Chromium send null.
  headers.set('Referrer-Policy', headers.get('Referrer-Policy') === 'same-origin' ? 'same-origin' : 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, headers });
}
async function issue(env: Env, uid: string, origin: string) { const me = await user(env, uid, '/me'); const token = await signSession({ uid, version: me.version, exp: Math.floor(Date.now() / 1000) + SESSION_AGE }, env.SESSION_SECRET); return json({ user: { ...me.user, ...await identityFlags(env, uid) } }, 200, { 'Set-Cookie': cookie(cookieName, token, SESSION_AGE, origin) }); }
async function signedIn(request: Request, env: Env) { const s = await readSession(cookies(request)[cookieName], env.SESSION_SECRET); assert(s, 'Sign in required', 401); const me = await user(env, s.uid, '/me'); assert(me.version === s.version, 'Session expired', 401); return s; }
function originFor(request: Request, env: Env) { const origin = new URL(request.url).origin; if (env.APP_ORIGIN) assert(origin === new URL(env.APP_ORIGIN).origin, 'Wrong host', 403); return origin; }
async function authChallenge(env: Env, request: Request, kind: string) { const id = cookies(request).bh_flow; assert(id, 'Start sign-in again'); const flow = await registry(env, '/challenge/take', { id }); assert(flow && flow.kind === kind, 'Sign-in expired; start again'); return flow as Challenge; }

/** Telemetry is deliberately lossy: never forward arbitrary exception text or URLs. */
export function clientErrorRecord(input: ObjectData, origin: string) {
  const message = typeof input.message === 'string' ? input.message : '';
  const errorName = /^(?:(?:Unhandled |Uncaught (?:\(in promise\) )?))?(TypeError|ReferenceError|RangeError|SyntaxError|URIError|EvalError|Error|AbortError|NetworkError|QuotaExceededError|InvalidStateError|SecurityError)(?=:|$)/.exec(message)?.[1];
  const stack = typeof input.stack === 'string' ? input.stack.split('\n').flatMap(line => {
    const localFrame = line.match(/^\/(?:assets\/[a-zA-Z0-9_.-]+\.(?:js|mjs)|sw\.js):\d+:\d+$/); if (localFrame) return [localFrame[0]];
    const match = line.match(/https?:\/\/[^\s)]+/); if (!match) return [];
    try { const frame = new URL(match[0]); if (frame.origin !== origin || frame.search || frame.hash || !/^\/(?:assets\/[a-zA-Z0-9_.-]+\.(?:js|mjs)|sw\.js):\d+:\d+$/.test(frame.pathname)) return []; return [frame.pathname]; } catch { return []; }
  }).slice(0, 5).join('\n') : '';
  // Incord is a single-path app. Do not retain arbitrary paths, query strings, or fragments.
  const route = typeof input.route === 'string' && /^\/(?:account|today|library|practice|learned|gallery)?(?:[?#].*)?$/.test(input.route) ? input.route.split(/[?#]/)[0] : '/';
  const version = typeof input.version === 'string' && /^(?:[a-f0-9]{7,40}|dev|development|unknown)$/.test(input.version) ? input.version : 'unknown';
  const uaFamily = ['Safari', 'Chrome', 'Chromium', 'Firefox', 'Edge', 'Other'].includes(String(input.uaFamily ?? input.ua)) ? String(input.uaFamily ?? input.ua) : 'Other';
  return { message: errorName || 'Client error (message omitted)', stack, route, version, uaFamily };
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, origin = originFor(request, env);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assert(request.headers.get('Origin') === origin, 'Cross-origin write denied', 403);
  if (path === '/api/config' && request.method === 'GET') return json({ email: emailEnabled(env, request), google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), googleEnabled: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), push: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), vapidPublicKey: env.VAPID_PUBLIC_KEY || null });
  if (path === '/api/test/last-code') assert(emailTestMode(env, request) && request.method === 'GET', 'Not found', 404);
  assert(env.SESSION_SECRET?.length >= 32, 'Service secrets are not configured', 503);
  if (path === '/api/test/last-code') { assert(emailTestMode(env, request) && request.method === 'GET', 'Not found', 404); return json(await registry(env, '/email/test-get', { key: await emailKey(env, normalizeEmail(url.searchParams.get('email'))) })); }
  if (path === '/api/log' && request.method === 'POST') {
    await registry(env, '/limit', { key: 'log:' + await digest(env.SESSION_SECRET + ':' + (request.headers.get('CF-Connecting-IP') || 'local')), limit: 10, window: 60_000 });
    const input = await body(request, 2048);
    console.log(JSON.stringify({ evt: 'client_error', ...clientErrorRecord(input, origin) }));
    return json({ ok: true });
  }
  if (path === '/api/esv') return handleEsv(request, env, {
    signedIn: async () => { try { await signedIn(request, env); return true; } catch (error) { if (error instanceof ApiError && error.status === 401) return false; throw error; } },
    anonymousAllowed: async (limit, windowSeconds) => { try { await registry(env, '/limit', { key: 'esv:' + await digest(env.SESSION_SECRET + ':' + (request.headers.get('CF-Connecting-IP') || 'local')), limit, window: windowSeconds * 1000 }); return true; } catch (error) { if (error instanceof ApiError && error.status === 429) return false; throw error; } },
  });
  if (path.startsWith('/api/auth/')) {
    await registry(env, '/limit', { key: await digest(env.SESSION_SECRET + ':' + (request.headers.get('CF-Connecting-IP') || 'local')), limit: 60, window: 900_000 });
    if ((path === '/api/auth/email/start' || path === '/api/auth/email/verify') && request.method === 'POST') {
      assert(emailEnabled(env, request), 'Email sign-in is not enabled.', 404);
      const input = await body(request, 2048), email = normalizeEmail(input.email), key = await emailKey(env, email);
      const linkUid = input.link === true ? (await signedIn(request, env)).uid : undefined;
      if (path.endsWith('/start')) {
        const code = generateLoginCode(), hash = await loginCodeHash(env, key, code);
        await registry(env, '/email/start', { key, hash, uid: linkUid, ip: await hmac(env.SESSION_SECRET, 'email-ip:' + (request.headers.get('CF-Connecting-IP') || 'local')), ...(emailTestMode(env, request) ? { testCode: code } : {}) });
        if (!emailTestMode(env, request)) await sendLoginCode(env, email, code);
        return json({ ok: true, message: 'Check your email for a six-digit code.' });
      }
      assert(typeof input.code === 'string' && /^\d{6}$/.test(input.code), 'Enter the six-digit code.');
      const result = await registry(env, '/email/verify', { key, hash: await loginCodeHash(env, key, input.code), uid: linkUid });
      await user(env, result.uid, '/init', { name: 'Friend' });
      return issue(env, result.uid, origin);
    }

    if (path === '/api/auth/logout-everywhere' && request.method === 'POST') { const session = await signedIn(request, env); await user(env, session.uid, '/revoke'); assert((await oauthCall(env,'/revoke-all',{origin,uid:session.uid})).ok,'Unable to disconnect apps. Please try again.',503); return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) }); }
    if (path === '/api/auth/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) });
    if (path === '/api/auth/google' && request.method === 'GET') {
      assert(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET, 'Google sign-in is not enabled', 404); const state = random(), verifier = random(48);
      await registry(env, '/challenge/set', { id: state, value: { kind: 'google', challenge: state, verifier } });
      const target = new URL('https://accounts.google.com/o/oauth2/v2/auth'); target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: origin + '/api/auth/google/callback', response_type: 'code', scope: 'openid profile email', state, code_challenge: await digest(verifier), code_challenge_method: 'S256' }).toString();
      return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie('bh_flow', state, 300, origin), 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/auth/google/callback' && request.method === 'GET') {
      assert(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET, 'Google sign-in is not enabled', 404); assert(url.searchParams.get('state') === cookies(request).bh_flow, 'Invalid OAuth state'); const flow = await authChallenge(env, request, 'google'); const code = url.searchParams.get('code'); assert(code, 'Google sign-in cancelled');
      const tokens = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: flow.verifier!, grant_type: 'authorization_code', redirect_uri: origin + '/api/auth/google/callback' }) }); assert(tokens.ok, 'Google sign-in failed', 401);
      const token = await tokens.json<{ access_token: string }>(); const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } }); assert(profileResponse.ok, 'Google sign-in failed', 401);
      const profile = await profileResponse.json<{ sub: string; name?: string; email?: string; email_verified?: boolean; hd?: string }>(); assert(profile.sub, 'Google profile missing', 401);
      // Google is authoritative only for Gmail or verified Workspace addresses.
      // Other verified addresses may have changed owners since Google verified them.
      const verifiedEmail = profile.email_verified === true && profile.email ? normalizeEmail(profile.email) : undefined;
      const authoritativeEmail = verifiedEmail && (verifiedEmail.endsWith('@gmail.com') || (profile.hd && verifiedEmail.endsWith('@' + profile.hd.toLowerCase())));
      const mapping = await registry(env, '/google', { sub: profile.sub, ...(authoritativeEmail ? { emailKey: await emailKey(env, verifiedEmail!) } : {}) }); await user(env, mapping.uid, '/init', { name: profile.name || 'Friend' });
      const login = await issue(env, mapping.uid, origin);
      return new Response(null, { status: 302, headers: { Location: '/?signedIn=1', 'Set-Cookie': login.headers.get('Set-Cookie')!, 'Cache-Control': 'no-store' } });
    }
    throw new ApiError(404, 'Route not found');
  }
  let session: Session;
  try { session = await signedIn(request, env); } catch (error) { if (path === '/api/me' && request.method === 'GET' && error instanceof ApiError && error.status === 401) return json({ user: null, ...(error.message === 'Session expired' ? { signedOutEverywhere: true } : {}) }); throw error; }
  const uid = session.uid;
  if (path === '/api/oauth/consent') {
    if(request.method==='GET')return oauthCall(env,'/consent',{origin,url:origin+'/oauth/authorize'+url.search,headers:[...request.headers],uid,version:session.version});
    if(request.method==='POST'){const input=await body(request,4096);assert(typeof input.handle==='string'&&input.handle.length<=1024,'Invalid consent');return oauthCall(env,'/decision',{origin,url:origin+'/oauth/authorize',method:'POST',headers:[...request.headers],handle:input.handle,decision:input.decision,uid,version:session.version,statsEnabled:input.statsEnabled===true&&request.headers.get('DNT')!=='1'&&request.headers.get('Sec-GPC')!=='1'});}
  }
  if(path==='/api/oauth/privacy'&&request.method==='POST'){const input=await body(request,1024);assert(typeof input.enabled==='boolean','Invalid privacy preference');return json(await user(env,uid,'/mcp/privacy',{enabled:input.enabled}));}
  if(path==='/api/oauth/apps'&&request.method==='GET')return oauthCall(env,'/apps',{origin,uid});
  if(path==='/api/oauth/revoke'&&request.method==='POST'){const input=await body(request,4096);assert(typeof input.id==='string'&&input.id.length<=200,'Invalid connected app');return oauthCall(env,'/revoke',{origin,uid,id:input.id});}
  if (path === '/api/me' && request.method === 'GET') { const me = await user(env, uid, '/me'), flags = await identityFlags(env, uid); return json({ user: { ...me.user, ...flags } }); }
  if (path === '/api/sync' && request.method === 'POST') { const input = await body(request); const result = await user(env, uid, '/sync', input); await registry(env, '/schedule/set', { uid }); return json(result); }
  if (path === '/api/export' && request.method === 'GET') return json(await user(env, uid, '/export'), 200, { 'Content-Disposition': 'attachment; filename="incord.json"' });
  if (path === '/api/account' && request.method === 'DELETE') { assert((await oauthCall(env,'/revoke-all',{origin,uid})).ok,'Unable to disconnect apps. Please try again.',503); await user(env, uid, '/delete'); await registry(env, '/delete', { uid }); return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) }); }
  if (path === '/api/push/subscribe' && request.method === 'POST') { const input = await body(request); assert(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY, 'Push is not configured', 503); const result = await user(env, uid, '/push/subscribe', { ...input, origin }); await registry(env, '/schedule/set', { uid }); return json(result); }
  if (path === '/api/push/status' && request.method === 'GET') {
    const endpointHash = url.searchParams.get('endpointHash');
    assert(endpointHash === null || /^[a-f0-9]{64}$/.test(endpointHash), 'Invalid endpoint hash');
    return json(await user(env, uid, '/push/status', { endpointHash, origin }));
  }
  if (path === '/api/push/test' && request.method === 'POST') { await registry(env, '/limit', { key: 'push:' + uid, limit: 3, window: 60_000 }); return json(await user(env, uid, '/push/test')); }
  throw new ApiError(404, 'Route not found');
}
const legacyServiceWorker = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.registration.unregister();for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){const url=new URL(client.url);url.hostname='incord.jesklabs.com';url.protocol='https:';url.port='';await client.navigate(url.href)}})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.mode==='navigate'){url.hostname='incord.jesklabs.com';url.protocol='https:';url.port='';event.respondWith(Response.redirect(url.href,301))}});`;
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = request.headers.get('cf-ray')?.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 100) || crypto.randomUUID();
    const finish = async (response: Response, unexpected = false, errorName?: string) => {
      if (response.status >= 500) {
        console.log(JSON.stringify({ evt: 'server_error', requestId, status: response.status, unexpected, ...(errorName ? { errorName } : {}) }));
      }
      if (response.status >= 400 && !/^\/(?:mcp(?:\/|$)|oauth(?:\/|$)|\.well-known\/oauth-)/.test(new URL(request.url).pathname) && (new URL(request.url).pathname.startsWith('/api/') || response.headers.get('Content-Type')?.includes('application/json'))) {
        let error = 'Something went wrong. Please try again.';
        try { const data = await response.json<{ error?: string }>(); if (data.error) error = data.error; } catch { /* Do not log response content. */ }
        response = json({ error, requestId }, response.status);
      }
      const result = secure(response); result.headers.set('X-Request-ID', requestId); return result;
    };
    try {
      const url = new URL(request.url), path = url.pathname;
      if (url.hostname === 'byheart.jesklabs.com') {
        if (path === '/sw.js') return finish(new Response(legacyServiceWorker, { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' } }));
        if (path.startsWith('/api/')) return finish(json({ error: 'Incord has moved. Update this app at https://incord.jesklabs.com.' }, 410));
        url.hostname = 'incord.jesklabs.com'; url.protocol = 'https:'; url.port = ''; return finish(Response.redirect(url.href, 301));
      }
      const mcpResponse = /^\/(?:mcp(?:\/|$)|oauth\/(?:token|register)$|\.well-known\/oauth-)/.test(path) ? await (await import('./mcp')).handleMcpRequest(request,env,ctx) : null;
      if(mcpResponse)return await finish(mcpResponse);
      const statsResponse = await handleStatsRequest(request, env);
      if (statsResponse) return await finish(statsResponse);
      if (path.startsWith('/api/')) return await finish(await api(request, env));
      let response = await env.ASSETS.fetch(request);
      // Static misses stay 404; only extensionless HTML app routes get the shell.
      if (response.status === 404 && ['GET', 'HEAD'].includes(request.method)
        && !/^\/(content|assets)(?:\/|$)/.test(path) && !path.split('/').some(part => part.includes('.'))
        && request.headers.get('Accept')?.includes('text/html')) {
        response = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      }
      return await finish(response);
    } catch (error) {
      if (error instanceof ApiError) return finish(json({ error: error.message }, error.status));
      return finish(json({ error: 'Something went wrong. Please try again.' }, 500), true,
        error instanceof Error && ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'].includes(error.name) ? error.name : 'Error');
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        const { users } = await registry(env, '/schedule/due');
        const results = await Promise.allSettled(users.map((uid: string) => user(env, uid, '/push/remind')));
        if (results.some(r => r.status === 'rejected')) throw new Error('One or more reminder checks failed');
      } catch {
        const requestId = crypto.randomUUID();
        console.log(JSON.stringify({ evt: 'server_error', requestId, status: 500, unexpected: true, source: 'scheduled' }));
        throw new Error('Reminder checks failed; request ' + requestId);
      }
    })());
  },
} satisfies ExportedHandler<Env>;

export class RegistryDO {
  private sql: SqlStorage;
  constructor(private ctx: DurableObjectState) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS mapping(kind TEXT NOT NULL,id TEXT NOT NULL,uid TEXT NOT NULL,PRIMARY KEY(kind,id))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS mapping_user ON mapping(uid)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS email_codes(id TEXT PRIMARY KEY,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL,uid TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS email_test(id TEXT PRIMARY KEY,code TEXT NOT NULL,expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS schedule(uid TEXT PRIMARY KEY,next_at INTEGER NOT NULL)');
  }
  private rows(query: string, ...args: (string | number)[]) { return [...this.sql.exec<Row>(query, ...args)]; }
  async fetch(request: Request) { return this.ctx.blockConcurrencyWhile(async () => { try {
    const data = await request.json<any>(), path = new URL(request.url).pathname, now = Date.now();
    this.sql.exec('DELETE FROM challenges WHERE expires < ?', now); this.sql.exec('DELETE FROM limits WHERE expires < ?', now);
    if (path === '/limit') { const row = this.rows('SELECT count FROM limits WHERE id=?', data.key)[0]; assert(!row || Number(row.count) < data.limit, 'Too many requests. Try again later.', 429); this.sql.exec('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1', data.key, now + data.window); return json({ ok: true }); }
    if (path === '/challenge/set') { this.sql.exec('INSERT INTO challenges VALUES(?,?,?)', data.id, JSON.stringify(data.value), now + 300_000); return json({ ok: true }); }
    if (path === '/challenge/take') { const row = this.rows('SELECT value FROM challenges WHERE id=?', data.id)[0]; this.sql.exec('DELETE FROM challenges WHERE id=?', data.id); return json(row ? JSON.parse(String(row.value)) : null); }
    if (path === '/identity') { const kinds = this.rows('SELECT DISTINCT kind FROM mapping WHERE uid=?', data.uid).map(r => r.kind); return json({ hasEmail: kinds.includes('email'), hasGoogle: kinds.includes('google') }); }
    if (path === '/email/test-get') return json(this.rows('SELECT code FROM email_test WHERE id=? AND expires>?', data.key, now)[0] || {});
    if (path === '/email/start') {
      this.sql.exec('DELETE FROM email_codes WHERE expires<=?', now); this.sql.exec('DELETE FROM email_test WHERE expires<=?', now);
      // Both counters and replacement are one synchronous transaction.
      this.ctx.storage.transactionSync(() => {
        for (const [id, limit] of [['email:' + data.key, 3], ['email-ip:' + data.ip, 10]] as const) { const row = this.rows('SELECT count FROM limits WHERE id=?', id)[0]; assert(!row || Number(row.count) < limit, 'Too many codes requested. Please try again in 15 minutes.', 429); }
        for (const id of ['email:' + data.key, 'email-ip:' + data.ip]) this.sql.exec('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1', id, now + 900_000);
        this.sql.exec('INSERT OR REPLACE INTO email_codes VALUES(?,?,?,0,?)', data.key, data.hash, now + 600_000, data.uid || null);
        if (data.testCode) this.sql.exec('INSERT OR REPLACE INTO email_test VALUES(?,?,?)', data.key, data.testCode, now + 600_000);
      }); return json({ ok: true });
    }
    if (path === '/email/verify') {
      const row = this.rows('SELECT * FROM email_codes WHERE id=?', data.key)[0];
      assert(row && Number(row.expires) > now && Number(row.attempts) < 5, 'That code is invalid or expired. Request a new code.', 401);
      const valid = constantTimeEqual(String(row.hash), data.hash) && (row.uid || undefined) === data.uid;
      if (!valid) { this.sql.exec('UPDATE email_codes SET attempts=attempts+1 WHERE id=?', data.key); if (Number(row.attempts) >= 4) this.sql.exec('DELETE FROM email_codes WHERE id=?', data.key); throw new ApiError(401, 'That code is invalid or expired. Request a new code.'); }
      this.sql.exec('DELETE FROM email_codes WHERE id=?', data.key); this.sql.exec('DELETE FROM email_test WHERE id=?', data.key);
      const old = this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'email', data.key)[0];
      assert(!data.uid || !old || old.uid === data.uid, 'That email already belongs to another account.', 409);
      const uid = data.uid || old?.uid || crypto.randomUUID(); this.sql.exec('INSERT OR IGNORE INTO mapping VALUES(?,?,?)', 'email', data.key, uid); return json({ uid });
    }
    if (path === '/google') {
      const old = this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'google', data.sub)[0];
      const email = data.emailKey ? this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'email', data.emailKey)[0] : undefined;
      const uid = old?.uid || email?.uid || crypto.randomUUID();
      this.sql.exec('INSERT OR IGNORE INTO mapping VALUES(?,?,?)', 'google', data.sub, uid);
      // An existing Google identity wins; never steal another account's email.
      if (data.emailKey) this.sql.exec('INSERT OR IGNORE INTO mapping VALUES(?,?,?)', 'email', data.emailKey, uid);
      return json({ uid });
    }
    if (path === '/schedule/set') { this.sql.exec('INSERT OR IGNORE INTO schedule VALUES(?,0)', data.uid); return json({ ok: true }); }
    if (path === '/schedule/due') { const users = this.rows('SELECT uid FROM schedule WHERE next_at<=? ORDER BY next_at LIMIT 200', now).map(row => row.uid); for (const uid of users) this.sql.exec('UPDATE schedule SET next_at=? WHERE uid=?', now + 15 * 60_000, uid); return json({ users }); }
    if (path === '/delete') { this.sql.exec('DELETE FROM mapping WHERE uid=?', data.uid); this.sql.exec("DELETE FROM challenges WHERE json_extract(value,'$.uid')=?", data.uid); this.sql.exec('DELETE FROM email_codes WHERE uid=?', data.uid); this.sql.exec('DELETE FROM schedule WHERE uid=?', data.uid); return json({ ok: true }); }
    return json({ error: 'Not found' }, 404);
  } catch (e) { if (e instanceof ApiError) return json({ error: e.message }, e.status); throw e; } }); }
}

type SyncRecord = ObjectData & { id: string; updatedAt: number | string; deleted?: boolean };
export function timestamp(value: unknown) { const n = typeof value === 'string' ? Date.parse(value) : value; assert(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Date.now() + 300_000, 'Invalid updatedAt'); return n; }
function record(value: unknown): asserts value is SyncRecord { assert(value && typeof value === 'object' && !Array.isArray(value)); const r = value as ObjectData; assert(typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 160, 'Invalid id'); assert(JSON.stringify(value).length <= 50_000, 'Item too large'); timestamp(r.updatedAt); }
export function localDay(now: Date, timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
const settingAliases:Record<string,string>={name:'displayName',theme:'appearance',goal:'weeklyGoal',timeZone:'timezone',pushEnabled:'remindersEnabled'};
/** Per-field LWW; legacy records without field clocks use their record revision. */
export function mergeServerSettings(old:any,incoming:any){const result={...old,fieldUpdatedAt:{...old.fieldUpdatedAt}};for(const key of Object.keys(old))if(key!=='updatedAt'&&key!=='fieldUpdatedAt'&&result.fieldUpdatedAt[key]===undefined)result.fieldUpdatedAt[key]=old.fieldUpdatedAt?0:old.updatedAt??0;for(const key of Object.keys(incoming)){if(key==='updatedAt'||key==='fieldUpdatedAt')continue;const before=old.fieldUpdatedAt?.[key]??(old.fieldUpdatedAt?0:old.updatedAt??0),after=incoming.fieldUpdatedAt?.[key]??(incoming.fieldUpdatedAt?0:incoming.updatedAt??0);if(after>before||(after===before&&JSON.stringify(incoming[key])>JSON.stringify(old[key]))){result[key]=incoming[key];result.fieldUpdatedAt[key]=after}}result.updatedAt=Math.max(old.updatedAt||0,incoming.updatedAt||0);return result}
export function settingsRecord(input: unknown): ObjectData { assert(input && typeof input === 'object' && !Array.isArray(input), 'Invalid settings'); const s = { ...(input as ObjectData) }; timestamp(s.updatedAt);
  if (s.name !== undefined) s.displayName = s.name; if (s.theme !== undefined) s.appearance = s.theme; if (s.goal !== undefined) s.weeklyGoal = s.goal; if (s.timeZone !== undefined) s.timezone = s.timeZone; if (s.pushEnabled !== undefined) s.remindersEnabled = s.pushEnabled;
  for (const key of ['keySounds', 'haptics']) if (s[key] !== undefined) assert(typeof s[key] === 'boolean', 'Invalid keyboard feedback setting');
  if (s.remindersEnabled !== undefined) assert(typeof s.remindersEnabled === 'boolean', 'Invalid reminder setting');
  if (s.displayName !== undefined) { assert(typeof s.displayName === 'string' && s.displayName.length <= 80, 'Invalid display name'); s.name = s.displayName = s.displayName.trim(); }
  if (s.weeklyGoal !== undefined) assert([3, 4, 5, 7].includes(Number(s.weeklyGoal)), 'Invalid weekly goal');
  if (s.defaultTranslation !== undefined) assert(['BSB', 'KJV', 'WEB', 'ESV'].includes(String(s.defaultTranslation)), 'Invalid default translation');
  if (s.textSize !== undefined) assert(['small', 'default', 'large', 'extra-large'].includes(String(s.textSize)), 'Invalid text size');
  if (s.appearance !== undefined) assert(['system', 'light', 'dark'].includes(String(s.appearance)), 'Invalid appearance');
  if (s.reminderTime !== undefined) assert(typeof s.reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminderTime), 'Invalid reminder time');
  if (s.newPerDay !== undefined) assert([1,2,3,5].includes(Number(s.newPerDay)), 'Invalid daily limit');
  if (s.timezone !== undefined) { assert(typeof s.timezone === 'string' && s.timezone.length > 0, 'Invalid timezone'); try { new Intl.DateTimeFormat('en', { timeZone: String(s.timezone) }).format(); } catch { throw new ApiError(400, 'Invalid timezone'); } }
  if(s.fieldUpdatedAt !== undefined) { assert(s.fieldUpdatedAt && typeof s.fieldUpdatedAt === 'object' && !Array.isArray(s.fieldUpdatedAt), 'Invalid field timestamps'); for(const value of Object.values(s.fieldUpdatedAt)) timestamp(value); const times = {...s.fieldUpdatedAt as Record<string,unknown>}; for(const [from,to] of Object.entries(settingAliases)) if(times[from] !== undefined) times[to] = times[from]; s.fieldUpdatedAt = times; }
  assert(JSON.stringify(s).length < 10_000, 'Settings too large'); return s;
}
export class UserDO {
  private sql: SqlStorage;
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    // Retained for existing DO schema compatibility only; authentication never reads/writes it.
    this.sql.exec('CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,value TEXT NOT NULL,updated INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,value TEXT NOT NULL)');
  }
  private rows(query: string, ...args: (string | number)[]) { return [...this.sql.exec<Row>(query, ...args)]; }
  private get(key: string): any { const row = this.rows('SELECT value FROM meta WHERE key=?', key)[0]; return row ? JSON.parse(String(row.value)) : null; }
  private set(key: string, value: unknown) { this.sql.exec('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  private list(table: string) { assert(['items', 'events', 'subscriptions'].includes(table)); return this.rows(`SELECT value FROM ${table} ORDER BY ${table === 'subscriptions' ? 'endpoint' : 'id'}`).map(row => JSON.parse(String(row.value))); }
  private settings() { return this.get('settings') || { appearance: 'system', weeklyGoal: 4, reminderTime: '09:00', timezone: 'UTC', remindersEnabled: false, keySounds: false, haptics: false, updatedAt: 0 }; }
  async fetch(request: Request) { return this.ctx.blockConcurrencyWhile(async () => { try {
    const data = await request.json<any>(), path = new URL(request.url).pathname;
    if (path === '/delete') { await this.ctx.storage.deleteAll(); this.sql.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)'); this.set('deleted', true); return json({ ok: true }); }
    assert(!this.get('deleted'), 'Account no longer exists', 401);
    if (path === '/init') {
      if (!this.get('profile')) { this.set('profile', { id: this.ctx.id.toString(), displayName: data.name || 'Friend', createdAt: Date.now() }); this.set('version', 1); }
      return json({ ok: true });
    }
    assert(this.get('profile'), 'Account not found', 401);
    if (path === '/me') { const profile = this.get('profile'); return json({ user: { ...profile, displayName: this.settings().displayName === undefined ? profile.displayName : (this.settings().displayName || 'Friend'), settings: this.settings() }, version: this.get('version'),mcpCountsEnabled:this.get('mcpCountsEnabled')!==false }); }
    if (path === '/revoke') { this.set('version', this.get('version') + 1); return json({ ok: true }); }
    if(path==='/mcp/privacy'){assert(typeof data.enabled==='boolean');this.set('mcpCountsEnabled',data.enabled);return json({ok:true});}
    if(path==='/mcp/add') {
      assert(data.version===undefined||data.version===this.get('version'),'Session expired',401);
      assert(Array.isArray(data.items)&&data.items.length<=10000,'Too many verses in one call');
      const results:any[]=[],admitted:any[]=[],existing=new Map(this.list('items').map(i=>[i.id,i]));
      // Insert-if-absent and device sync share the same merge, caps and ESV path.
      // One batch transaction avoids re-reading the whole library for every verse.
      for(const source of data.items){
        assert(source&&typeof source.id==='string','Invalid item');const old=existing.get(source.id);
        if(old&&!old.deleted){results.push({id:source.id,status:'already in library'});continue;}
        // A low initial revision lets an unsynced device's existing practice win.
        const now=Date.now(),item=stripEsvText({...source,origin:'mcp',step:1,learned:false,deleted:false,due:new Date(now).toISOString(),createdAt:new Date(now).toISOString(),updatedAt:old?timestamp(old.updatedAt)+1:1});
        try{
          record(item);assert(existing.has(item.id)||existing.size<10000,'Account item limit reached');
          if(item.translation==='ESV'||item.id.startsWith('esv-'))try{assertEsvLimit([...existing.values()].filter(i=>i.id!==item.id).concat(item));}catch(error){throw new ApiError(400,error instanceof Error?error.message:'ESV limit reached');}
          existing.set(item.id,item);admitted.push(item);results.push({id:item.id,status:'added'});
        }catch(error){if(error instanceof ApiError)results.push({id:source.id,status:'invalid reference',reason:error.message});else throw error;}
      }
      this.mergeData(admitted,[],null);return json({results});
    }
    if (path === '/sync') {
      const incomingItems = data.items || [], events = data.events || []; assert(Array.isArray(incomingItems), 'Invalid items'); const items = incomingItems.map((item: any) => item && typeof item.id === 'string' ? stripEsvText(item) : item); assert(Array.isArray(items) && items.length <= 1000 && Array.isArray(events) && events.length <= 2000, 'Sync batch too large');
      for (const item of items) record(item);
      for (const event of events) { assert(event && typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 160 && JSON.stringify(event).length <= 10_000, 'Invalid event'); assert(event.timestamp !== undefined || event.createdAt !== undefined || event.at !== undefined, 'Event needs timestamp, createdAt, or at'); timestamp(event.timestamp ?? event.createdAt ?? event.at); }
      const settings = data.settings ? settingsRecord(data.settings) : null;
      this.mergeData(items,events,settings);
      return json({ items: this.list('items'), events: this.list('events'), settings: this.settings(), serverTime: Date.now() });
    }
    if(path==='/mcp/state')return json({items:this.list('items'),settings:this.settings(),events:data.events?this.list('events').map(({itemId,at,mode})=>({itemId,at,mode})):[]});
    if (path === '/export') return json({ format: 'by-heart', version: 1, exportedAt: new Date().toISOString(), user: { ...this.get('profile'), displayName: this.settings().displayName === undefined ? this.get('profile').displayName : (this.settings().displayName || 'Friend') }, items: this.list('items'), events: this.list('events'), settings: this.settings() });
    if (path === '/push/subscribe') {
      if (data.subscription === null || data.enabled === false) { if (data.endpoint) this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', data.endpoint); else this.sql.exec('DELETE FROM subscriptions'); return json({ ok: true }); }
      const sub = (data.subscription || data) as PushSubscriptionData; validateSubscription(sub); assert(this.list('subscriptions').filter(existing => data.origin !== 'https://incord.jesklabs.com' || (existing.origin && existing.origin !== 'https://byheart.jesklabs.com')).length < 5 || this.rows('SELECT endpoint FROM subscriptions WHERE endpoint=?', sub.endpoint).length, 'Device limit reached');
      // Keep legacy subscriptions until their replacement has been accepted.
      this.sql.exec('INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET value=excluded.value', sub.endpoint, JSON.stringify({ ...sub, origin: data.origin }));
      if (data.origin === 'https://incord.jesklabs.com') for (const old of this.list('subscriptions')) if (!old.origin || old.origin === 'https://byheart.jesklabs.com') this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', old.endpoint); return json({ ok: true });
    }
    if (path === '/push/status') {
      const endpointHashes = await Promise.all(this.list('subscriptions').map(sub => endpointHash(sub.endpoint)));
      return json({ subscribed: !!data.endpointHash && endpointHashes.includes(data.endpointHash), endpointHashes, oldOriginOnly: this.list('subscriptions').length > 0 && this.list('subscriptions').every(sub => !sub.origin || sub.origin === 'https://byheart.jesklabs.com'), results: this.get('pushResults') || [] });
    }
    if (path === '/push/test') return json(await this.sendPush(true));
    if (path === '/push/remind') return json(await this.sendPush(false));
    return json({ error: 'Not found' }, 404);
  } catch (e) { if (e instanceof ApiError) return json({ error: e.message }, e.status); throw e; } }); }
  private mergeData(items:any[],events:any[],settings:any) {
      this.ctx.storage.transactionSync(() => {
        assert(Number(this.rows('SELECT COUNT(*) AS n FROM items')[0].n) + items.filter((i: SyncRecord) => !this.rows('SELECT id FROM items WHERE id=?', i.id).length).length <= 10_000, 'Account item limit reached');
        assert(Number(this.rows('SELECT COUNT(*) AS n FROM events')[0].n) + events.filter((e: ObjectData) => !this.rows('SELECT id FROM events WHERE id=?', String(e.id)).length).length <= 100_000, 'Account review log limit reached');
        const prospective = new Map(this.list('items').map(item => [item.id, item]));
        for (const item of items) { const old = prospective.get(item.id); if (!old || timestamp(item.updatedAt) > timestamp(old.updatedAt) || (timestamp(item.updatedAt) === timestamp(old.updatedAt) && JSON.stringify(item) > JSON.stringify(old))) prospective.set(item.id, item); }
        try { assertEsvLimit([...prospective.values()]); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'ESV limit reached'); }
        for (const item of items as SyncRecord[]) {
          const serialized = JSON.stringify(item), updated = timestamp(item.updatedAt); const existing = this.rows('SELECT updated,value FROM items WHERE id=?', item.id)[0];
          // Equal-timestamp conflicts converge deterministically, independent of arrival order.
          if (!existing || updated > Number(existing.updated) || (updated === Number(existing.updated) && serialized > String(existing.value))) this.sql.exec('INSERT INTO items VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated=excluded.updated', item.id, serialized, updated);
        }
        for (const event of events) this.sql.exec('INSERT OR IGNORE INTO events VALUES(?,?)', event.id, JSON.stringify(event));
        if (settings) this.set('settings', mergeServerSettings(this.settings(), settings));
      });
  }
  private async sendPush(test: boolean) {
    assert(this.env.VAPID_PRIVATE_KEY && this.env.VAPID_PUBLIC_KEY, 'Push is not configured', 503); const settings = this.settings(), now = new Date(), today = localDay(now, settings.timezone || 'UTC');
    let dueCount = 0;
    if (!test) {
      if (!settings.remindersEnabled || this.get('remindedDay') === today) return { sent: 0, failed: 0, results: [] };
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone || 'UTC', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
      // Cron is quarter-hourly: permit the 15-minute window following the chosen time.
      const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); const delta = (minutes(clock) - minutes(settings.reminderTime || '09:00') + 1440) % 1440; if (delta >= 15) return { sent: 0, failed: 0, results: [] };
      if (this.list('events').some(e => localDay(new Date(e.timestamp ?? e.createdAt ?? e.at), settings.timezone || 'UTC') === today)) return { sent: 0, failed: 0, results: [] };
      dueCount = this.list('items').filter(i => !i.deleted && (!i.learned || !i.due && !i.dueAt && !i.card?.due || new Date(i.dueAt ?? i.due ?? i.card?.due).getTime() <= now.getTime())).length; if (!dueCount) return { sent: 0, failed: 0, results: [] };
      this.set('remindedDay', today); // Reserve before network I/O, so retries cannot duplicate a daily reminder.
    }
    let sent = 0, failed = 0;
    const results: PushResult[] = [];
    for (const sub of this.list('subscriptions')) {
      const started = Date.now(), host = new URL(sub.endpoint).hostname;
      let status = 0, reason = '';
      try {
        const response = await sendWebPush(sub, { title: 'Incord', body: test ? 'Test notification. Reminders are working.' : `You have ${dueCount} ${dueCount === 1 ? 'item' : 'items'} to practice today.`, url: '/', tag: test ? 'by-heart-test' : 'by-heart-daily', renotify: test }, this.env);
        status = response.status;
        reason = await pushReason(response, sub, this.env);
        if (response.ok) sent++; else failed++;
        if (status === 404 || status === 410) this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', sub.endpoint);
      } catch (error) {
        failed++; reason = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'Push request timed out' : 'Push delivery failed';
      }
      const result = { time: Date.now(), host, status, reason };
      results.push(result);
      this.set('pushResults', [result, ...(this.get('pushResults') || [])].slice(0, 10));
      console.log(JSON.stringify({ evt: 'push', kind: test ? 'test' : 'remind', host, status, reason, ms: Date.now() - started }));
    }
    return { sent, failed, results };
  }
}

type PushResult = { time: number; host: string; status: number; reason: string };
export async function endpointHash(endpoint: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(endpoint)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function pushReason(response: Response, sub: PushSubscriptionData, env: Env) {
  // Bound the read even if a provider returns an unexpectedly large response.
  const reader = response.body?.getReader(); if (!reader) return '';
  let value = '';
  try { const decoder = new TextDecoder(); while (value.length < 4096) { const part = await reader.read(); if (part.done) break; value += decoder.decode(part.value.subarray(0, 4096), { stream: true }); } } finally { await reader.cancel(); }
  for (const secret of [sub.endpoint, sub.keys.auth, sub.keys.p256dh, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY]) if (secret) value = value.split(secret).join('[redacted]');
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/[^\s"<>]+/g, '[url]').slice(0, 200);
}
type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };
export function validateSubscription(sub: PushSubscriptionData) {
  assert(sub && typeof sub.endpoint === 'string' && sub.endpoint.length < 2048 && sub.keys, 'Invalid push subscription');
  let endpoint: URL; try { endpoint = new URL(sub.endpoint); } catch { throw new ApiError(400, 'Invalid push endpoint'); } const host = endpoint.hostname;
  assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && (!endpoint.port || endpoint.port === '443') && (host === 'fcm.googleapis.com' || host === 'android.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com')), 'Unsupported push service');
  try { assert(unb64(sub.keys.p256dh).length === 65 && unb64(sub.keys.auth).length === 16, 'Invalid subscription keys'); } catch { throw new ApiError(400, 'Invalid subscription keys'); }
}
function concat(...parts: Uint8Array[]) { const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { all.set(part, at); at += part.length; } return all; }
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) { const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)); }
export async function sendWebPush(subscription: PushSubscriptionData, payload: unknown, env: Env): Promise<Response> {
  validateSubscription(subscription); const uaPublic = unb64(subscription.keys.p256dh), auth = unb64(subscription.keys.auth);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair; const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, pair.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32), salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const clear = concat(encoder.encode(JSON.stringify(payload)), new Uint8Array([2])); assert(clear.length < 3993, 'Push payload too large');
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']); const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, clear));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length;
  const vapid = unb64(env.VAPID_PUBLIC_KEY!); assert(vapid.length === 65, 'Invalid VAPID public key', 503);
  const signingKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64(vapid.slice(1, 33)), y: b64(vapid.slice(33)), d: env.VAPID_PRIVATE_KEY!, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const subject = env.VAPID_SUBJECT || 'mailto:hello@jesklabs.com';
  assert(/^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject), 'Invalid VAPID subject', 503);
  const unsigned = b64(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64(encoder.encode(JSON.stringify({ aud: new URL(subscription.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 1800, sub: subject })));
  const signature = b64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(unsigned))));
  // Workers do not support redirect: error. Manual refuses forwarding VAPID credentials; 3xx is a delivery failure.
  return fetch(subscription.endpoint, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { TTL: '3600', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${unsigned}.${signature}, k=${env.VAPID_PUBLIC_KEY}` }, body: concat(header, asPublic, cipher) });
}
